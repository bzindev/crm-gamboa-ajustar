const WINDOW_MS = 24 * 60 * 60 * 1000;

// Regra da Cloud API: só dá para mandar texto livre até 24h depois da
// última mensagem recebida do cliente; depois disso, só template aprovado
// (fora do escopo desta fase). Usado tanto para validar o envio quanto para
// decidir se o campo de texto aparece habilitado na tela.
export function isWithin24hWindow(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;
}
