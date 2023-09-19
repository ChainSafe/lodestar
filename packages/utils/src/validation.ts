export function isValidHttpUrl(urlStr: string): boolean {
  let url;
  try {
    url = new URL(urlStr);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}
