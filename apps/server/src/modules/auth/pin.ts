import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PIN_PATTERN = /^\d{4,6}$/;
const KEY_LENGTH = 32;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Formato: scrypt$<salt base64>$<hash base64>. Sin dependencias nativas. */
export async function hashPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new Error('El PIN debe tener de 4 a 6 dígitos.');
  const salt = randomBytes(16);
  const key = await derive(pin, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await derive(pin, Buffer.from(saltB64, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
