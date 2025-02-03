import {toBase64} from "@lodestar/utils";

export enum HttpHeader {
  ContentType = "content-type",
  Accept = "accept",
  Authorization = "authorization",
  /**
   * Used to indicate which response headers should be made available to
   * scripts running in the browser, in response to a cross-origin request.
   * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Expose-Headers
   */
  ExposeHeaders = "access-control-expose-headers",
}

export enum MediaType {
  json = "application/json",
  ssz = "application/octet-stream",
}

export const SUPPORTED_MEDIA_TYPES = Object.values(MediaType);

function isSupportedMediaType(mediaType: string | null, supported: MediaType[]): mediaType is MediaType {
  return mediaType !== null && supported.includes(mediaType as MediaType);
}

export function parseContentTypeHeader(contentType?: string): MediaType | null {
  if (!contentType) {
    return null;
  }

  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();

  return isSupportedMediaType(mediaType, SUPPORTED_MEDIA_TYPES) ? mediaType : null;
}

export function parseAcceptHeader(accept?: string, supported = SUPPORTED_MEDIA_TYPES): MediaType | null {
  if (!accept) {
    return null;
  }

  // Respect Quality Values per RFC-9110
  // Acceptable mime-types are comma separated with optional whitespace
  return accept
    .toLowerCase()
    .split(",")
    .map((x) => x.trim())
    .reduce(
      (best: [number, MediaType | null], current: string): [number, MediaType | null] => {
        // An optional `;` delimiter is used to separate the mime-type from the weight
        // Normalize here, using 1 as the default qvalue
        const quality = current.includes(";") ? current.split(";") : [current, "q=1"];

        let mediaType = quality[0].trim();

        if (mediaType === "*/*") {
          // Default to json if all media types are accepted
          mediaType = MediaType.json;
        }

        // If the mime type isn't acceptable, move on to the next entry
        if (!isSupportedMediaType(mediaType, supported)) {
          return best;
        }

        // Otherwise, the portion after the semicolon has optional whitespace and the constant prefix "q="
        const weight = quality[1].trim();
        if (!weight.startsWith("q=")) {
          // If the format is invalid simply move on to the next entry
          return best;
        }

        const qvalue = +weight.replace("q=", "");
        if (Number.isNaN(qvalue) || qvalue > 1 || qvalue <= 0) {
          // If we can't convert the qvalue to a valid number, move on
          return best;
        }

        if (qvalue < best[0]) {
          // This mime type is not preferred
          return best;
        }

        // This mime type is preferred
        return [qvalue, mediaType];
      },
      [0, null]
    )[1];
}

export function setAuthorizationHeader(url: URL, headers: Headers, {bearerToken}: {bearerToken?: string}): void {
  if (bearerToken && !headers.has(HttpHeader.Authorization)) {
    headers.set(HttpHeader.Authorization, `Bearer ${bearerToken}`);
  }
  if (url.username || url.password) {
    if (!headers.has(HttpHeader.Authorization)) {
      headers.set(HttpHeader.Authorization, `Basic ${toBase64(decodeURIComponent(`${url.username}:${url.password}`))}`);
    }
    // Remove the username and password from the URL
    url.username = "";
    url.password = "";
  }
}

export function mergeHeaders(...headersList: (HeadersInit | undefined)[]): Headers {
  const mergedHeaders = new Headers();

  for (const headers of headersList) {
    if (!headers) {
      continue;
    }
    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        mergedHeaders.set(key, value);
      }
    } else if (headers instanceof Headers) {
      for (const [key, value] of headers as unknown as Iterable<[string, string]>) {
        mergedHeaders.set(key, value);
      }
    } else {
      for (const [key, value] of Object.entries(headers)) {
        mergedHeaders.set(key, value);
      }
    }
  }

  return mergedHeaders;
}

/**
 * Get header from request headers, by default an error will be thrown if the header
 * is not present. The header can be marked as optional in which case the return value
 * might be `undefined` but no error will be thrown if header is missing.
 */
export function fromHeaders<T extends Record<string, string | undefined>, R extends boolean = true>(
  headers: T,
  name: Extract<keyof T, string>,
  required: R = true as R
): R extends true ? string : string | undefined {
  // Fastify converts all headers to lower case
  const header = headers[name.toLowerCase()];

  if (header === undefined && required) {
    throw Error(`${name} header is required`);
  }

  return header as R extends true ? string : string | undefined;
}

/**
 * Extension of Headers object returned by Fetch API
 */
export class HeadersExtra extends Headers {
  /**
   * Get required header from response headers
   */
  getRequired(name: string): string {
    const header = this.get(name);

    if (header === null) {
      throw Error(`${name} header is required in response`);
    }

    return header;
  }

  /**
   * Get optional header from response headers.
   * Return default value if it does not exist
   */
  getOrDefault(name: string, defaultValue: string): string {
    return this.get(name) ?? defaultValue;
  }
}
