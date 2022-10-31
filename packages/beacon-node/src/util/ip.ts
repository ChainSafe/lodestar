/**
 * Returns true if string represents a localhost IP (v4 or v6)
 */
export function isLocalhostIP(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "0:0:0:0:0:0:0:1";
}
