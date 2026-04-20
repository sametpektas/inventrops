import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY environment variable is not set');
  // Derive a 32-byte key from the provided string
  return scryptSync(raw, 'inventrops-salt', 32);
}

/**
 * Encrypts a plain text string using AES-256-GCM.
 * Returns a base64-encoded string: iv:tag:ciphertext
 */
export function encrypt(plainText: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv):base64(tag):base64(ciphertext)
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

/**
 * Decrypts a string previously encrypted with encrypt().
 * If the value is not in encrypted format (legacy plain text), returns it as-is.
 */
export function decrypt(encryptedText: string): string {
  // If not in our encrypted format, return as-is (backward compat / plain text fallback)
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText;

  try {
    const key = getKey();
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const cipherText = Buffer.from(parts[2], 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Decryption failed — might be an old plain-text value, return as-is
    return encryptedText;
  }
}

/**
 * Returns true if the given string appears to be encrypted by this module.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3;
}
