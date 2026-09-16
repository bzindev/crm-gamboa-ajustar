import "server-only";
import crypto from "node:crypto";

/**
 * X-Hub-Signature-256 é "sha256=<hex>", HMAC SHA-256 do corpo CRU (antes de
 * qualquer parse) com o App Secret. Comparação em tempo constante
 * (timingSafeEqual) para não dar pista sobre a assinatura certa por medir
 * quanto tempo a comparação levou.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expectedHex = signatureHeader.slice("sha256=".length);
  const computedHex = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const expected = Buffer.from(expectedHex, "hex");
  const computed = Buffer.from(computedHex, "hex");

  if (expected.length !== computed.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, computed);
}
