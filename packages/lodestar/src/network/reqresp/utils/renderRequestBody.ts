import {toHexString} from "@chainsafe/lodestar-utils";
import {Method, RequestBodyByMethod, RequestBody} from "../types";

/**
 * Render requestBody as a succint string for debug purposes
 */
export function renderRequestBody(method: Method, requestBody: RequestBody): string {
  switch (method) {
    case Method.Status:
      // Don't log any data
      return "";

    case Method.Goodbye:
      return (requestBody as RequestBodyByMethod[Method.Goodbye]).toString(10);

    case Method.Ping:
      return (requestBody as RequestBodyByMethod[Method.Ping]).toString(10);

    case Method.Metadata:
      return "null";

    case Method.BeaconBlocksByRange: {
      const range = requestBody as RequestBodyByMethod[Method.BeaconBlocksByRange];
      return `${range.startSlot},${range.step},${range.count}`;
    }

    case Method.BeaconBlocksByRoot:
      return ((requestBody as RequestBodyByMethod[Method.BeaconBlocksByRoot]) as Uint8Array[])
        .map((root) => toHexString(root))
        .join(",");
  }
}
