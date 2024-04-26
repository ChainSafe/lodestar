import {toBase64} from "@lodestar/utils";
import {ServerError} from "./error.js";

export enum WireFormat {
  json = "json",
  ssz = "ssz",
}

export enum MediaType {
  json = "application/json",
  ssz = "application/octet-stream",
}

export function getWireFormat(mediaType: MediaType): WireFormat {
  switch (mediaType) {
    case MediaType.json:
      return WireFormat.json;
    case MediaType.ssz:
      return WireFormat.ssz;
  }
}

export const supportedMediaTypes = Object.values(MediaType);

function isSupportedMediaType(mediaType: string | null): mediaType is MediaType {
  return mediaType !== null && supportedMediaTypes.includes(mediaType as MediaType);
}

export function parseContentTypeHeader(contentType?: string): MediaType | null {
  if (!contentType) {
    return null;
  }

  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();

  return isSupportedMediaType(mediaType) ? mediaType : null;
}

export function parseAcceptHeader(accept?: string): MediaType | null {
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

        const mediaType = quality[0].trim();

        // If the mime type isn't acceptable, move on to the next entry
        if (!isSupportedMediaType(mediaType)) {
          return best;
        }

        // Otherwise, the portion after the semicolon has optional whitespace and the constant prefix "q="
        const weight = quality[1].trim();
        if (!weight.startsWith("q=")) {
          // If the format is invalid simply move on to the next entry
          return best;
        }

        const qvalue = +weight.replace("q=", "");
        if (isNaN(qvalue) || qvalue > 1 || qvalue <= 0) {
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
  if (bearerToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  if (url.username || url.password) {
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Basic ${toBase64(decodeURIComponent(`${url.username}:${url.password}`))}`);
    }
    // Remove the username and password from the URL
    url.username = "";
    url.password = "";
  }
}

export function mergeHeaders(a: HeadersInit | undefined, b: HeadersInit | undefined): Headers {
  if (!a) {
    return new Headers(b);
  }
  const headers = new Headers(a);
  if (!b) {
    return headers;
  }
  if (Array.isArray(b)) {
    for (const [key, value] of b) {
      headers.set(key, value);
    }
  } else if (b instanceof Headers) {
    for (const [key, value] of b as unknown as Iterable<[string, string]>) {
      headers.set(key, value);
    }
  } else {
    for (const [key, value] of Object.entries(b)) {
      headers.set(key, value);
    }
  }
  return headers;
}

export function fromHeaders<T extends Record<string, string>>(headers: T, name: Extract<keyof T, string>): string {
  // Fastify converts all headers to lower case
  const header = headers[name.toLowerCase()];

  if (header === undefined) {
    throw Error(`${name} header is required`);
  }

  return header;
}
