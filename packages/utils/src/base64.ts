const hasBufferFrom = typeof Buffer !== "undefined" && typeof Buffer.from === "function";

export function toBase64(value: string): string {
  return hasBufferFrom ? Buffer.from(value).toString("base64") : btoa(value);
}

export function fromBase64(value: string): string {
  return hasBufferFrom ? Buffer.from(value, "base64").toString("utf8") : atob(value);
}
