/**
 * @module network
 */

import {deserialize, serialize} from "@chainsafe/ssz";

import {RequestBody, ResponseBody, WireRequest, WireResponse} from "@chainsafe/eth2-types";
import {RequestId, Method} from "../constants";
import {IBeaconConfig} from "../config";

// Encode

export function encodeRequest(
  config: IBeaconConfig,
  id: RequestId,
  method: Method,
  body: RequestBody
): Buffer {
  let encodedBody: Buffer;
  switch (method) {
    case Method.Hello:
      encodedBody = serialize(body, config.types.Hello);
      break;
    case Method.Goodbye:
      encodedBody = serialize(body, config.types.Goodbye);
      break;
    case Method.Status:
      encodedBody = serialize(body, config.types.Status);
      break;
    case Method.BeaconBlockRoots:
      encodedBody = serialize(body, config.types.BeaconBlockRootsRequest);
      break;
    case Method.BeaconBlockHeaders:
      encodedBody = serialize(body, config.types.BeaconBlockHeadersRequest);
      break;
    case Method.BeaconBlockBodies:
      encodedBody = serialize(body, config.types.BeaconBlockBodiesRequest);
      break;
    case Method.BeaconStates:
      encodedBody = serialize(body, config.types.BeaconStatesRequest);
      break;
    default:
      throw new Error(`Invalid method ${method}`);
  }
  const request: WireRequest = {
    id: Buffer.from(id, 'hex'),
    method: method,
    body: encodedBody,
  };
  return serialize(request, config.types.WireRequest);
}

export function encodeResponse(
  config: IBeaconConfig,
  id: RequestId,
  method: Method,
  responseCode: number,
  result: ResponseBody
): Buffer {
  const response: WireResponse = {
    id: Buffer.from(id, 'hex'),
    responseCode,
    result: Buffer.alloc(0),
  };
  if (responseCode !== 0) { // error response
    return serialize(response, config.types.WireResponse);
  }
  switch (method) {
    case Method.Hello:
      response.result = serialize(result, config.types.Hello);
      break;
    case Method.Goodbye:
      response.result = serialize(result, config.types.Goodbye);
      break;
    case Method.Status:
      response.result = serialize(result, config.types.Status);
      break;
    case Method.BeaconBlockRoots:
      response.result = serialize(result, config.types.BeaconBlockRootsResponse);
      break;
    case Method.BeaconBlockHeaders:
      response.result = serialize(result, config.types.BeaconBlockHeadersResponse);
      break;
    case Method.BeaconBlockBodies:
      response.result = serialize(result, config.types.BeaconBlockBodiesResponse);
      break;
    case Method.BeaconStates:
      response.result = serialize(result, config.types.BeaconStatesResponse);
      break;
    default:
      throw new Error(`Invalid method ${method}`);
  }
  return serialize(response, config.types.WireResponse);
}

// Decode

export function decodeRequestBody(config: IBeaconConfig, method: Method, body: Buffer): RequestBody {
  switch (method) {
    case Method.Hello:
      return deserialize(body, config.types.Hello);
    case Method.Goodbye:
      return deserialize(body, config.types.Goodbye);
    case Method.Status:
      return deserialize(body, config.types.Status);
    case Method.BeaconBlockRoots:
      return deserialize(body, config.types.BeaconBlockRootsRequest);
    case Method.BeaconBlockHeaders:
      return deserialize(body, config.types.BeaconBlockHeadersRequest);
    case Method.BeaconBlockBodies:
      return deserialize(body, config.types.BeaconBlockBodiesRequest);
    case Method.BeaconStates:
      return deserialize(body, config.types.BeaconStatesRequest);
    default:
      throw new Error(`Invalid method ${method}`);
  }
}

export function decodeResponseBody(config: IBeaconConfig, method: Method, result: Buffer): ResponseBody {
  switch (method) {
    case Method.Hello:
      return deserialize(result, config.types.Hello);
    case Method.Goodbye:
      return deserialize(result, config.types.Goodbye);
    case Method.Status:
      return deserialize(result, config.types.Status);
    case Method.BeaconBlockRoots:
      return deserialize(result, config.types.BeaconBlockRootsResponse);
    case Method.BeaconBlockHeaders:
      return deserialize(result, config.types.BeaconBlockHeadersResponse);
    case Method.BeaconBlockBodies:
      return deserialize(result, config.types.BeaconBlockBodiesResponse);
    case Method.BeaconStates:
      return deserialize(result, config.types.BeaconStatesResponse);
    default:
      throw new Error(`Invalid method ${method}`);
  }
}

export function sanityCheckData(data: Buffer): boolean {
  return Buffer.isBuffer(data) && data.length >= 10;
}
