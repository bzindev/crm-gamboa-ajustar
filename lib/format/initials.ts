/**
 * Iniciais pro avatar. Só conta palavras que começam com letra ou número —
 * "Cliente Demonstração (teste)" dava "C(" pegando o parêntese; telefone
 * sem nome ("+5511…") vira os dois primeiros dígitos.
 */
export function getInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  const initials = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : words[0].slice(0, 2);
  return initials.toUpperCase();
}
