/**
 * @module network/hobbits/rpc
 */

import {deserialize, serialize} from "@chainsafe/ssz";
import {RequestId, Method} from "../constants";
import {RequestBody, ResponseBody} from "../../../types";
import {IBeaconConfig} from "../../../config";


// Encode

export function encodeRequestBody(
  config: IBeaconConfig,
  id: RequestId,
  method: Method,
  body: RequestBody | ResponseBody
): Buffer {
  let encodedBody: Buffer;
  switch (method) {
    case Method.Hello:
      encodedBody = serialize(body, config.types.HobbitsHello);
      break;
    case Method.Goodbye:
      encodedBody = serialize(body, config.types.Goodbye);
      break;
    case Method.GetStatus:
      encodedBody = serialize(body, config.types.HobbitsStatus);
      break;
    case Method.GetBlockHeaders:
      encodedBody = serialize(body, config.types.HobbitsGetBlockHeaders);
      break;
    case Method.BlockHeaders:
      encodedBody = serialize(body, config.types.BeaconBlockHeadersResponse);
      break;
    case Method.GetBlockBodies:
      encodedBody = serialize(body, config.types.HobbitsGetBlockBodies);
      break;
    case Method.BlockBodies:
      encodedBody = serialize(body, config.types.HobbitsBlockBodies);
      break;
    case Method.GetAttestation:
      encodedBody = serialize(body, config.types.HobbitsGetAttestation);
      break;
    case Method.AttestationResponse:
      encodedBody = serialize(body, config.types.HobbitsAttestation);
      break;
    case Method.GetBeaconStates:
      encodedBody = serialize(body, config.types.BeaconStatesRequest);
      break;
    case Method.BeaconStates:
      encodedBody = serialize(body, config.types.BeaconStatesResponse);
      break;
    default:
      throw new Error(`Invalid method ${method}`);
  }

  return encodedBody;
}

// Decode

export function decodeRequestBody(
  config: IBeaconConfig, method: Method, body: Buffer
): RequestBody {
  switch (method) {
    case Method.Hello:
      return deserialize(body, config.types.HobbitsHello);
    case Method.Goodbye:
      return deserialize(body, config.types.Goodbye);
    case Method.GetStatus:
      return deserialize(body, config.types.HobbitsStatus);
    case Method.GetBlockHeaders:
      return deserialize(body, config.types.HobbitsGetBlockHeaders);
    case Method.BlockHeaders:
      return deserialize(body, config.types.BeaconBlockHeadersResponse);
    case Method.GetBlockBodies:
      return deserialize(body, config.types.HobbitsGetBlockBodies);
    case Method.BlockBodies:
      return deserialize(body, config.types.HobbitsBlockBodies);
    case Method.GetAttestation:
      return deserialize(body, config.types.HobbitsGetAttestation);
    case Method.AttestationResponse:
      return deserialize(body, config.types.HobbitsAttestation);
    case Method.GetBeaconStates:
      return deserialize(body, config.types.BeaconStatesRequest);
    case Method.BeaconStates:
      return deserialize(body, config.types.BeaconStatesResponse);
    default:
      throw new Error(`Invalid method ${method}`);
  }
}

export function sanityCheckData(data: Buffer): boolean {
  return Buffer.isBuffer(data) && data.length >= 10;
}
