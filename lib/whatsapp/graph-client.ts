import "server-only";

function baseUrl(): string {
  const version = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v23.0";
  return `https://graph.facebook.com/${version}`;
}

export class GraphApiError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "GraphApiError";
    this.code = code;
  }
}

async function parseGraphError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null);
  const error = body?.error;
  throw new GraphApiError(error?.message ?? `Graph API respondeu ${response.status}`, error?.code);
}

/** Confirma que o token/phone_number_id funcionam antes de salvar o canal. */
export async function getPhoneNumberInfo(phoneNumberId: string, accessToken: string) {
  const response = await fetch(
    `${baseUrl()}/${phoneNumberId}?fields=verified_name,display_phone_number`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    await parseGraphError(response);
  }
  return (await response.json()) as { verified_name?: string; display_phone_number?: string };
}

/** POST /{phone-number-id}/messages — texto livre dentro da janela de 24h. */
export async function sendTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: string,
) {
  const response = await fetch(`${baseUrl()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!response.ok) {
    await parseGraphError(response);
  }

  const data = (await response.json()) as { messages?: { id: string }[] };
  const wamid = data.messages?.[0]?.id;
  if (!wamid) {
    throw new GraphApiError("A Meta não devolveu o id da mensagem enviada.");
  }
  return { wamid };
}

/** POST /{phone-number-id}/messages genérico — devolve o wamid da mensagem enviada. */
async function postMessage(phoneNumberId: string, accessToken: string, to: string, message: Record<string, unknown>) {
  const response = await fetch(`${baseUrl()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...message }),
  });
  if (!response.ok) {
    await parseGraphError(response);
  }
  const data = (await response.json()) as { messages?: { id: string }[] };
  const wamid = data.messages?.[0]?.id;
  if (!wamid) {
    throw new GraphApiError("A Meta não devolveu o id da mensagem enviada.");
  }
  return { wamid };
}

/**
 * POST /{phone-number-id}/media — sobe o arquivo pra Meta e devolve o id
 * de mídia usado no envio. Upload em vez de mandar um link público: o
 * arquivo fica num bucket privado e nunca precisa ficar aberto na internet.
 */
export async function uploadMedia(phoneNumberId: string, accessToken: string, file: Blob, mimeType: string, fileName: string) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new File([file], fileName, { type: mimeType }));
  const response = await fetch(`${baseUrl()}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!response.ok) {
    await parseGraphError(response);
  }
  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new GraphApiError("A Meta não devolveu o id do arquivo enviado.");
  return data.id;
}

/** Foto, vídeo, áudio ou documento já subido com uploadMedia. Áudio não tem legenda (regra da Meta). */
export async function sendMediaMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  params: { kind: "image" | "video" | "audio" | "document"; mediaId: string; caption?: string; fileName?: string },
) {
  const media: Record<string, string> = { id: params.mediaId };
  if (params.caption && params.kind !== "audio") media.caption = params.caption;
  if (params.kind === "document" && params.fileName) media.filename = params.fileName;
  return postMessage(phoneNumberId, accessToken, to, { type: params.kind, [params.kind]: media });
}

export async function sendLocationMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  location: { latitude: number; longitude: number; name?: string; address?: string },
) {
  return postMessage(phoneNumberId, accessToken, to, { type: "location", location });
}

/**
 * Mídia recebida do cliente: GET /{media-id} devolve uma URL temporária
 * (expira em minutos) que também exige o token — por isso o worker baixa
 * na hora e guarda no Storage, em vez de guardar a URL.
 */
export async function downloadMedia(mediaId: string, accessToken: string) {
  const info = await fetch(`${baseUrl()}/${mediaId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!info.ok) {
    await parseGraphError(info);
  }
  const meta = (await info.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.url) throw new GraphApiError("A Meta não devolveu o endereço do arquivo.");
  const file = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!file.ok) throw new GraphApiError(`Falha ao baixar o arquivo da Meta (${file.status}).`);
  return { data: await file.arrayBuffer(), mimeType: meta.mime_type ?? file.headers.get("content-type") ?? "application/octet-stream" };
}

/**
 * POST /{phone-number-id}/messages com type "template" — o único jeito de
 * iniciar conversa fora da janela de 24h. `bodyParams` preenche as
 * variáveis {{1}}, {{2}}... na ordem, na única seção BODY do template
 * (v1 não suporta header/footer/botão com variável).
 */
export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
) {
  const response = await fetch(`${baseUrl()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components:
          bodyParams.length > 0
            ? [
                {
                  type: "body",
                  parameters: bodyParams.map((text) => ({ type: "text", text })),
                },
              ]
            : undefined,
      },
    }),
  });

  if (!response.ok) {
    await parseGraphError(response);
  }

  const data = (await response.json()) as { messages?: { id: string }[] };
  const wamid = data.messages?.[0]?.id;
  if (!wamid) {
    throw new GraphApiError("A Meta não devolveu o id da mensagem enviada.");
  }
  return { wamid };
}

/**
 * POST /{waba-id}/message_templates — submete o template pra aprovação da
 * Meta. Categoria e corpo não dá para editar depois de aprovado (a Meta
 * trata como um template novo); por isso não existe "editar", só criar de
 * novo com outro nome se precisar mudar o texto.
 */
export async function createMessageTemplate(
  wabaId: string,
  accessToken: string,
  params: { name: string; language: string; category: string; bodyText: string; hasVariable?: boolean },
) {
  // Com {{1}} no texto, a Meta exige um exemplo de preenchimento pra
  // aprovar — sem ele, recusa o template na hora.
  const body = params.hasVariable
    ? { type: "BODY", text: params.bodyText, example: { body_text: [["Maria"]] } }
    : { type: "BODY", text: params.bodyText };
  const response = await fetch(`${baseUrl()}/${wabaId}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: params.name,
      language: params.language,
      category: params.category,
      components: [body],
    }),
  });

  if (!response.ok) {
    await parseGraphError(response);
  }

  return (await response.json()) as { id: string; status: string; category: string };
}

/** GET /{waba-id}/message_templates?name=... — consulta o status atual (a aprovação da Meta acontece fora do nosso controle, de minutos a dias). */
export async function getMessageTemplateStatus(wabaId: string, accessToken: string, name: string) {
  const response = await fetch(
    `${baseUrl()}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=status,rejected_reason`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    await parseGraphError(response);
  }
  const data = (await response.json()) as {
    data?: { status: string; rejected_reason?: string }[];
  };
  return data.data?.[0] ?? null;
}
