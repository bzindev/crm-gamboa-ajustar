// Campos de texto livre em relatórios (nome de contato, por exemplo) vêm
// de fora — nome de perfil do WhatsApp, digitado por qualquer um. Sem
// isso, um valor começando com "=", "+", "-" ou "@" vira fórmula executada
// sozinha ao abrir o CSV no Excel/Sheets (CSV injection).
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvEscape(value: string): string {
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  if (/[",\n;]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
