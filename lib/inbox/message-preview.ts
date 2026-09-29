// Sem "server-only": função pura, usada na lista de conversas, na linha do
// tempo do contato e testada em tests/message-preview.test.ts.

type Content = {
  body?: string | null;
  media?: { filename?: string } | null;
  location?: { name?: string | null; address?: string | null } | null;
} | null;

const LABEL: Record<string, string> = {
  image: "📷 Foto",
  video: "🎥 Vídeo",
  audio: "🎤 Áudio",
  document: "📄",
  sticker: "Figurinha",
  location: "📍",
  template: "",
};

/** Texto curto que representa a mensagem (lista do Inbox, histórico). */
export function messagePreview(type: string, content: unknown): string {
  const c = content as Content;
  const body = c?.body?.trim() || null;

  if (type === "location") {
    const place = c?.location?.name || c?.location?.address;
    return `📍 ${place ?? "Localização"}`;
  }
  if (type === "document") {
    const name = c?.media?.filename ?? "Documento";
    return body ? `📄 ${name} — ${body}` : `📄 ${name}`;
  }
  if (LABEL[type] && type !== "template") {
    return body ? `${LABEL[type]} · ${body}` : LABEL[type];
  }
  return body ?? `[${type}]`;
}
