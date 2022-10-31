import {toHexString} from "@lodestar/utils";
import {Method, RequestBody, RequestBodyByMethod} from "../types.js";

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
    case Method.LightClientFinalityUpdate:
    case Method.LightClientOptimisticUpdate:
      return "null";

    case Method.BeaconBlocksByRange: {
      const range = requestBody as RequestBodyByMethod[Method.BeaconBlocksByRange];
      return `${range.startSlot},${range.step},${range.count}`;
    }

    case Method.BeaconBlocksByRoot:
      return ((requestBody as RequestBodyByMethod[Method.BeaconBlocksByRoot]) as Uint8Array[])
        .map((root) => toHexString(root))
        .join(",");

    case Method.LightClientBootstrap:
      return toHexString((requestBody as RequestBodyByMethod[Method.LightClientBootstrap]) as Uint8Array);

    case Method.LightClientUpdate: {
      const updateRequest = requestBody as RequestBodyByMethod[Method.LightClientUpdate];
      return `${updateRequest.startPeriod},${updateRequest.count}`;
    }
  }
}
