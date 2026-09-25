export type PhoneNormalizationResult = { phone: string; error?: undefined } | { phone?: undefined; error: string };

const INVALID_FORMAT_ERROR = "Telefone inválido — confira o DDD e o número, ex.: (11) 99999-9999.";
const INVALID_INTERNATIONAL_ERROR = "Telefone internacional inválido, ex.: +14155550123.";
const E164_REGEX = /^\+[1-9]\d{7,14}$/;

/**
 * Planilha de contato brasileiro chega em qualquer formato — com/sem DDI,
 * com/sem parênteses e traço, com/sem o 9º dígito. Roda ANTES da validação
 * (contactSchema só aceita E.164 pronto) — sem isso, praticamente toda
 * linha de uma planilha exportada de um sistema de telefonia comum cai em
 * erro por formato, não por dado realmente ruim.
 *
 * Só reconhece "já tem DDI" quando o tamanho bate (12 ou 13 dígitos) —
 * sem essa checagem de tamanho, um número com DDD 55 (região de Santa
 * Cruz do Sul/Santa Maria, RS) seria confundido com o próprio código do
 * Brasil e o DDD real seria perdido.
 */
export function normalizeBrazilianPhone(raw: string): PhoneNormalizationResult {
  let digits = raw.replace(/\D/g, "");

  if (!digits) {
    return { error: "Telefone vazio." };
  }

  const hasCountryCode = digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
  if (!hasCountryCode) {
    digits = "55" + digits;
  }

  // Depois de garantir DDI (2) + DDD (2) = 4 dígitos, sobraram 8 pro
  // número em si — falta o 9º dígito (celular sem ele é formato antigo).
  if (digits.length === 12) {
    digits = digits.slice(0, 4) + "9" + digits.slice(4);
  }

  if (digits.length === 13 && digits.startsWith("55")) {
    return { phone: `+${digits}` };
  }

  // Não força um número que não fecha a conta — geralmente é DDD ausente
  // ou telefone incompleto, e não dá pra adivinhar isso com segurança.
  return { error: INVALID_FORMAT_ERROR };
}

/**
 * Cadastro manual (contato avulso ou criado junto com um lead): mesma
 * normalização brasileira da importação, exceto quando a pessoa digitou
 * explicitamente um "+" com outro código de país — aí aceita como número
 * estrangeiro em vez de tentar enfiar um 55 na frente. A importação
 * continua usando só normalizeBrazilianPhone (regra fechada: planilha é
 * toda do Brasil).
 */
export function normalizeContactPhone(raw: string): PhoneNormalizationResult {
  const trimmed = raw.trim();
  const compact = trimmed.replace(/[^\d+]/g, "");

  if (compact.startsWith("+") && !compact.startsWith("+55")) {
    const international = "+" + compact.replace(/\D/g, "");
    return E164_REGEX.test(international) ? { phone: international } : { error: INVALID_INTERNATIONAL_ERROR };
  }

  return normalizeBrazilianPhone(trimmed);
}
