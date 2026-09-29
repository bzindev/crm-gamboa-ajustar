// Sem "server-only": usado no botão "Gerar senha" (navegador) e testado.
// crypto.getRandomValues existe tanto no navegador quanto no Node.

// Sem caracteres ambíguos (0/O, 1/l/I) — a senha costuma ser ditada ou
// digitada a partir de um print.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((n) => ALPHABET[n % ALPHABET.length]).join("");
  // Separadores deixam mais fácil de ler/ditar: "Abc4-Xyz9-Pq7r".
  return body.match(/.{1,4}/g)!.join("-");
}
