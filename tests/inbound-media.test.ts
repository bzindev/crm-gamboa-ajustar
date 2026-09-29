import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { processInboundMessage } from "@/lib/whatsapp/process-events";
import { encryptToken, bufferToPgBytea } from "@/lib/crypto/token-cipher";

/**
 * Mídia recebida do cliente, contra banco e Storage reais. Só a Meta é
 * simulada (fetch pra graph.facebook.com / lookaside); todo o resto passa
 * pela rede de verdade.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && process.env.TOKEN_ENCRYPTION_KEY);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe.skipIf(!hasCredentials)("mídia recebida (worker)", () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const digits = `5511955${String(suffix).slice(-6)}`;
  let orgId: string;
  let channelId: string;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://graph.facebook.com/") && url.includes("/media-ok")) {
        return Response.json({ url: "https://lookaside.fbsbx.com/whatsapp/foto", mime_type: "image/jpeg", file_size: JPEG.length });
      }
      if (url.startsWith("https://graph.facebook.com/") && url.includes("/media-ruim")) {
        return Response.json({ error: { message: "Media not found", code: 100 } }, { status: 404 });
      }
      if (url.startsWith("https://lookaside.fbsbx.com/")) {
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      }
      return realFetch(input, init);
    });

    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    orgId = (await admin.from("organizations").insert({ name: "Org Mídia", slug: `org-teste-midia-${suffix}` }).select().single().throwOnError()).data!.id;
    channelId = (await admin.from("channels").insert({
      org_id: orgId,
      waba_id: `w-m-${suffix}`,
      phone_number_id: `pn-m-${suffix}`,
      status: "connected",
      access_token_encrypted: bufferToPgBytea(encryptToken("token-falso")),
    }).select().single().throwOnError()).data!.id;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    const { data: files } = await admin.storage.from("chat-media").list(orgId, { limit: 100 });
    for (const conv of files ?? []) {
      const { data: inner } = await admin.storage.from("chat-media").list(`${orgId}/${conv.name}`, { limit: 100 });
      for (const folder of inner ?? []) {
        const { data: leaf } = await admin.storage.from("chat-media").list(`${orgId}/${conv.name}/${folder.name}`);
        await admin.storage.from("chat-media").remove((leaf ?? []).map((f) => `${orgId}/${conv.name}/${folder.name}/${f.name}`));
      }
    }
    await admin.from("event_log").delete().eq("org_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
  });

  async function receive(wamid: string, payload: Record<string, unknown>) {
    await processInboundMessage(admin as never, orgId, {
      channel_id: channelId,
      wa_id: digits,
      wamid,
      contact_name: "Cliente Mídia",
      ...payload,
    });
    return (await admin.from("messages").select("type, content").eq("org_id", orgId).eq("wamid", wamid).single()).data!;
  }


  it("foto com legenda: baixa da Meta, guarda no Storage e a legenda vira o texto", async () => {
    const message = await receive(`wamid.foto-${suffix}`, {
      message_type: "image",
      text: "olha o carro",
      media: { id: "media-ok", mime_type: "image/jpeg", caption: "olha o carro", filename: null },
    });
    const content = message.content as { body: string; media: { path: string; mime: string; size: number } };
    expect(message.type).toBe("image");
    expect(content.body).toBe("olha o carro");
    expect(content.media).toMatchObject({ mime: "image/jpeg", size: JPEG.length });
    expect(content.media.path.startsWith(`${orgId}/`)).toBe(true);

    const { data: stored } = await admin.storage.from("chat-media").download(content.media.path);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(JPEG);
  });

  it("se a Meta falhar no download, a mensagem entra marcada como indisponível (não trava a fila)", async () => {
    const message = await receive(`wamid.ruim-${suffix}`, {
      message_type: "document",
      text: null,
      media: { id: "media-ruim", mime_type: "application/pdf", caption: null, filename: "CNH.pdf" },
    });
    expect(message.content).toMatchObject({ media: { filename: "CNH.pdf", unavailable: true } });
  });

  it("localização chega completa", async () => {
    const message = await receive(`wamid.loc-${suffix}`, {
      message_type: "location",
      text: null,
      location: { latitude: -23.55, longitude: -46.63, name: "Casa", address: null },
    });
    expect(message).toMatchObject({ type: "location", content: { location: { latitude: -23.55, longitude: -46.63, name: "Casa" } } });
  });
});
