import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Bearer CRON_SECRET em tempo constante — um "!==" comum responde um pouco
 * mais rápido quanto antes o texto diverge, o que em tese permite
 * descobrir o segredo por tentativa medindo o tempo de resposta.
 */
export function isCronAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
