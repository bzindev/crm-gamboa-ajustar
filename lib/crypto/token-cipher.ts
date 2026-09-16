import "server-only";
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY não configurada.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY precisa ter 32 bytes (openssl rand -base64 32).");
  }
  return key;
}

/**
 * Cifra em Node (AES-256-GCM), não em pgcrypto: pgp_sym_encrypt exigiria
 * mandar a chave como parâmetro de uma query SQL, arriscando vazar em log
 * de statement do Postgres. A chave nunca sai deste processo.
 *
 * Formato armazenado: iv (12 bytes) || authTag (16 bytes) || ciphertext.
 */
export function encryptToken(plainText: string): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptToken(stored: Buffer): string {
  const iv = stored.subarray(0, IV_LENGTH);
  const authTag = stored.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = stored.subarray(IV_LENGTH + 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plainText = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plainText.toString("utf8");
}

/**
 * PostgREST não tem tipo binário em JSON — representa `bytea` como texto
 * hexadecimal prefixado com "\x" (o formato de entrada/saída padrão do
 * Postgres para bytea). Essas duas funções são a ponte entre isso e um
 * Buffer normal do Node.
 */
export function bufferToPgBytea(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

export function pgByteaToBuffer(pgHex: string): Buffer {
  return Buffer.from(pgHex.replace(/^\\x/, ""), "hex");
}
