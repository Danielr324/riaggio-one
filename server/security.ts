import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keyLength: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [algorithm, saltB64, hashB64] = (stored ?? "").split("$");
  if (algorithm !== "scrypt" || !saltB64 || !hashB64) {
    // Igualar el coste de tiempo aunque el usuario no exista.
    await scrypt(password, randomBytes(16), KEY_LENGTH);
    return false;
  }
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Tokens opacos de alta entropía. Solo se guarda su hash en la base de datos.
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
