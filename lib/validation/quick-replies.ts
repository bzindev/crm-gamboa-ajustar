import { z } from "zod";

export const quickReplySchema = z.object({
  title: z.string().trim().min(1, "Dê um nome curto.").max(60, "Nome muito longo."),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(1000, "Mensagem muito longa."),
});

/** Troca {nome} pelo primeiro nome do contato (ou some com a variável se não tiver nome). */
export function fillQuickReply(body: string, contactName: string | null): string {
  const firstName = contactName?.trim().split(/\s+/)[0] ?? "";
  // Sem nome, leva junto a vírgula/espaço antes da variável: "Olá, {nome}!" → "Olá!".
  // No começo da frase ("{nome}, pra eu…") leva a vírgula que vem depois.
  const filled = firstName
    ? body.replace(/\{nome\}/gi, firstName)
    : body.replace(/^[ \t]*\{nome\}[, \t]*/i, "").replace(/[, \t]*\{nome\}/gi, "");
  const text = filled
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
