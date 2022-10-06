export function extractJwtHexSecret(jwtSecretContents: string): string {
  const hexPattern = new RegExp(/^(0x|0X)?(?<jwtSecret>[a-fA-F0-9]+)$/, "g");
  const jwtSecretHexMatch = hexPattern.exec(jwtSecretContents);
  const jwtSecret = jwtSecretHexMatch?.groups?.jwtSecret;
  if (!jwtSecret || jwtSecret.length !== 64) {
    throw Error(`Need a valid 256 bit hex encoded secret ${jwtSecret} ${jwtSecretContents}`);
  }
  // Return the secret in proper hex format
  return `0x${jwtSecret}`;
}
