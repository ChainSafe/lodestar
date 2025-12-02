export function isValidHttpUrl(urlStr: string): boolean {
  let url: URL;
  try {
    url = new URL(urlStr);

    // `new URL` encodes the username/password with the userinfo percent-encode set.
    // This means the `%` character is not encoded, but others are (such as `=`).
    // If a username/password contain a `%`, they will not be able to be decoded.
    //
    // Make sure that we can successfully decode the username and password here.
    //
    // Unfortunately this means we don't accept every character supported by RFC-3986.
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * Sanitize URL to prevent leaking user credentials in logs or metrics
 *
 * Note: `urlStr` must be a valid URL
 */
export function toPrintableUrl(urlStr: string): string {
  return new URL(urlStr).origin;
}
