/**
 * @module util/encrypt
 */

import crypto from "crypto";

const algorithm = "aes256";
const inputEncoding = "utf8";
const outputEncoding = "hex";

/**
 * Encrypts key
 * @param {string} value
 * @param {string} password
 * @returns {string}
 */
export function encryptKey(value: string, password: string): string {
  const cipher = crypto.createCipher(algorithm, password);
  let ciphered = cipher.update(value, inputEncoding, outputEncoding);
  ciphered += cipher.final(outputEncoding);

  return ciphered;
}

/**
 * Decrypts key
 * @param {string} value
 * @param {string} password
 * @returns {string}
 */
export function decryptKey(value: string, password: string): string {
  const decipher = crypto.createDecipher(algorithm, password);
  let deciphered: string;
  try {
    deciphered = decipher.update(value, outputEncoding, inputEncoding);
    deciphered += decipher.final(inputEncoding);
  }
  catch (e) {
    throw new Error("Invalid key or password to decode");
  }

  return deciphered;
}
