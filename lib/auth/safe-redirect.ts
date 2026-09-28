const INTERNAL_ORIGIN = "http://interno.local";

/**
 * Só aceita caminho interno do próprio site. Barra "//site" e também
 * "/\site": o navegador trata a barra invertida como "/" e "/\evil.com"
 * vira "//evil.com" — redirecionamento aberto pra fora do app. Caractere
 * de controle (quebra de linha etc.) também fica de fora.
 */
export function safeRedirectPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if ([...raw].some((char) => char === "\\" || char.charCodeAt(0) < 32)) return fallback;

  try {
    const url = new URL(raw, INTERNAL_ORIGIN);
    return url.origin === INTERNAL_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
