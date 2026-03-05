import {HttpStatusCode} from "../httpStatusCode.js";
import type {EngineSszMethodDescriptor} from "./engineSszMethodMap.js";

export const ENGINE_SSZ_CONTENT_TYPE = "application/octet-stream";
export const ENGINE_SSZ_ACCEPT = "application/octet-stream";

export type EngineSszRequestInit = {
  urlPath: string;
  method: "GET" | "POST";
  body?: Uint8Array;
  headers: Record<string, string>;
};

/**
 * Build request init data for Engine API binary SSZ transport.
 *
 * Spec note: both request and response use application/octet-stream.
 */
export function buildEngineSszRequestInit(
  descriptor: EngineSszMethodDescriptor,
  body?: Uint8Array
): EngineSszRequestInit {
  if (descriptor.httpMethod === "GET" && body !== undefined) {
    throw Error("GET SSZ engine request must not include a body");
  }

  return {
    urlPath: descriptor.path,
    method: descriptor.httpMethod,
    body,
    headers: {
      "Content-Type": ENGINE_SSZ_CONTENT_TYPE,
      Accept: ENGINE_SSZ_ACCEPT,
    },
  };
}

/**
 * Returns true when HTTP status indicates EL likely does not support
 * the requested SSZ endpoint.
 */
export function isEngineSszUnsupportedStatus(status: number): boolean {
  return (
    status === HttpStatusCode.NOT_FOUND ||
    status === HttpStatusCode.NOT_IMPLEMENTED ||
    status === HttpStatusCode.UNSUPPORTED_MEDIA_TYPE ||
    status === HttpStatusCode.BAD_REQUEST
  );
}
