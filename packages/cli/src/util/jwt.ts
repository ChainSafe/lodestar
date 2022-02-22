export function extractJwtHexSecret(jwtSecretContents: string): string {
  const hexPattern = new RegExp(/^(0x|0X)?(?<jwtSecret>[a-fA-F0-9]+)$/, "g");
  const jwtSecretHexMatch = hexPattern.exec(jwtSecretContents);
  const jwtSecretHex = jwtSecretHexMatch?.groups?.jwtSecret;
  if (!jwtSecretHex || jwtSecretHex.length != 64) {
    throw Error(`Need a valid 256 bit hex encoded secret ${jwtSecretHex} ${jwtSecretContents}`);
  }
  return jwtSecretHex;
}
