// Sem "server-only": usado no navegador (checar antes de subir o arquivo)
// e no servidor (checar de novo, nunca confiando no que veio do cliente).

export type MediaKind = "image" | "video" | "audio" | "document";

const MB = 1024 * 1024;

/**
 * Tipos e tamanhos que a Meta aceita no envio (Cloud API). Documento a
 * Meta aceita até 100 MB, mas o Storage do Supabase (plano gratuito) para
 * em 50 MB — vale o menor.
 */
export const MEDIA_RULES: Record<MediaKind, { label: string; maxBytes: number; mimes: string[]; accept: string }> = {
  image: {
    label: "Foto",
    maxBytes: 5 * MB,
    mimes: ["image/jpeg", "image/png"],
    accept: "image/jpeg,image/png",
  },
  video: {
    label: "Vídeo",
    maxBytes: 16 * MB,
    mimes: ["video/mp4", "video/3gpp"],
    accept: "video/mp4,video/3gpp",
  },
  audio: {
    label: "Áudio",
    maxBytes: 16 * MB,
    mimes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg", "audio/x-m4a"],
    accept: "audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,.m4a,.mp3,.ogg,.aac,.amr",
  },
  document: {
    label: "Documento",
    maxBytes: 50 * MB,
    mimes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
    ],
    accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv",
  },
};

/** Tipo aceito pelo WhatsApp pra esse arquivo, ou null. */
export function kindForMime(mime: string): MediaKind | null {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  for (const [kind, rule] of Object.entries(MEDIA_RULES) as [MediaKind, (typeof MEDIA_RULES)[MediaKind]][]) {
    if (rule.mimes.includes(normalized)) return kind;
  }
  return null;
}

/** Mensagem amigável se o arquivo não puder ir; null se estiver ok. */
export function validateMediaFile(mime: string, size: number): string | null {
  const kind = kindForMime(mime);
  if (!kind) {
    if (mime.startsWith("image/")) return "Foto precisa ser JPG ou PNG (foto de iPhone em HEIC: converta ou tire print).";
    if (mime.startsWith("video/")) return "Vídeo precisa ser MP4.";
    return "Esse tipo de arquivo o WhatsApp não aceita. Mande como PDF, Word, Excel, foto JPG/PNG, vídeo MP4 ou áudio.";
  }
  if (size <= 0) return "Arquivo vazio.";
  const rule = MEDIA_RULES[kind];
  if (size > rule.maxBytes) return `${rule.label} pode ter no máximo ${Math.round(rule.maxBytes / MB)} MB.`;
  return null;
}

/** Nome seguro pro caminho no Storage (sem acento, espaço ou barra). */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "");
  return (cleaned || "arquivo").slice(-120);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Coordenadas a partir do que a pessoa colar: "-23.55, -46.63" ou um link
 * do Google Maps (…/@-23.55,-46.63,17z, …?q=-23.55,-46.63, …!3d-23.55!4d-46.63).
 */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
  }
  return null;
}

export function mapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}
