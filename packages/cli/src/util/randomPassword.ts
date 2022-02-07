import crypto from "node:crypto";

const DEFAULT_PASSWORD_LEN = 48;

/**
 * Generates a hex encoded random password
 */
export function randomPassword(): string {
  return crypto.randomBytes(DEFAULT_PASSWORD_LEN).toString("hex");
}
