/**
 * @module network/hobbits/rpc
 */

import {deserialize, serialize} from "@chainsafe/ssz";

import {
  Hello, Goodbye, RequestBody, WireRequest, GetStatus, GetBlockHeaders, BlockBodies, GetBlockBodies, BlockHeaders,
} from "./messages";
import {RequestId, Method} from "../constants";

// Encode

export function encodeRequest(id: RequestId, method: Method, body: RequestBody): Buffer {
  let encodedBody: Buffer;
  switch (method) {
    case Method.Hello:
      encodedBody = serialize(body, Hello);
      break;
    case Method.Goodbye:
      encodedBody = serialize(body, Goodbye);
      break;
    case Method.GetStatus:
      encodedBody = serialize(body, GetStatus);
      break;
    case Method.GetBlockHeaders:
      encodedBody = serialize(body, GetBlockHeaders);
      break;
    case Method.BlockHeaders:
      encodedBody = serialize(body, BlockHeaders);
      break;
    case Method.GetBlockBodies:
      encodedBody = serialize(body, GetBlockBodies);
      break;
    case Method.BlockBodies:
      encodedBody = serialize(body, BlockBodies);
      break;
    default:
      throw new Error(`Invalid method ${method}`);
  }
  const request: WireRequest = {
    methodId: method,
    id: id,
    body: encodedBody,
  };
  return serialize(request, WireRequest);
}

// Decode

export function decodeRequestBody(method: Method, body: Buffer): RequestBody {
  switch (method) {
    case Method.Hello:
      return deserialize(body, Hello);
    case Method.Goodbye:
      return deserialize(body, Goodbye);
    case Method.GetStatus:
      return deserialize(body, GetStatus);
    case Method.GetBlockHeaders:
      return deserialize(body, GetBlockHeaders);
    case Method.BlockHeaders:
      return deserialize(body, BlockHeaders);
    case Method.GetBlockBodies:
      return deserialize(body, GetBlockBodies);
    case Method.BlockBodies:
      return deserialize(body, BlockBodies);
    default:
      throw new Error(`Invalid method ${method}`);
  }
}

export function sanityCheckData(data: Buffer): boolean {
  return Buffer.isBuffer(data) && data.length >= 10;
}
