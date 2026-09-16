import { GraphApiError } from "@/lib/whatsapp/graph-client";

/**
 * Códigos mais comuns da Graph API (ver documentação de "Error Codes" da
 * WhatsApp Cloud API). "Erro 400" não ajuda ninguém na tela — mapeamos os
 * que mais aparecem no dia a dia; o resto cai na mensagem original da Meta,
 * que já costuma ser legível.
 */
const KNOWN_CODES: Record<number, string> = {
  131047: "Fora da janela de 24h — só é possível responder com um template aprovado.",
  131026: "Mensagem não pôde ser entregue (número inválido ou sem WhatsApp).",
  131021: "Não é possível enviar mensagem para este número.",
  131056: "Limite de mensagens por segundo atingido. Tente de novo em instantes.",
  100: "Parâmetro inválido — confira o número de telefone e os dados do canal.",
  190: "Token de acesso do canal inválido ou expirado. Reconecte o canal.",
  10: "Sem permissão para esta ação com o token atual.",
};

export function mapGraphApiError(error: unknown): string {
  if (error instanceof GraphApiError) {
    if (error.code && KNOWN_CODES[error.code]) {
      return KNOWN_CODES[error.code];
    }
    return `Erro da Meta: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Erro desconhecido ao falar com o WhatsApp.";
}
