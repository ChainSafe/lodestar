/**
 * @module network
 */

import PeerId from "peer-id";
import PeerInfo from "peer-info";
import * as varint from "varint";

import {SignedBeaconBlock, Status, Goodbye} from "@chainsafe/eth2.0-types";
import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {RequestId, Method, MAX_CHUNK_SIZE, ERR_INVALID_REQ} from "../constants";
import {ResponseChunk} from "./interface";

// req/resp

function randomNibble(): string {
  return Math.floor(Math.random() * 16).toString(16);
}

export function randomRequestId(): RequestId {
  return Array.from({length: 16}, () => randomNibble()).join("");
}

export function createResponseEvent(id: RequestId): string {
  return `response ${id}`;
}

const REQ_PROTOCOL = "/eth2/beacon_chain/req/{method}/{version}/{encoding}";
export function createRpcProtocol(method: string, encoding: string, version = 1): string {
  return REQ_PROTOCOL
    .replace("{method}", method)
    .replace("{encoding}", encoding)
    .replace("{version}", String(version));
}

// peers

/**
 * Return a fresh PeerInfo instance
 */
export async function createPeerInfo(peerId: PeerId): Promise<PeerInfo> {
  return new PeerInfo(peerId);
}

/**
 * Return a fresh PeerId instance
 */
export async function createPeerId(): Promise<PeerId> {
  //keyType is missing in types
  return await PeerId.create({bits: 256, keyType: "secp256k1"});
}

export async function initializePeerInfo(peerId: PeerId, multiaddrs: string[]): Promise<PeerInfo> {
  const peerInfo = await createPeerInfo(peerId);
  multiaddrs.forEach((ma) => peerInfo.multiaddrs.add(ma));
  return peerInfo;
}

export function encodeResponseChunk(config: IBeaconConfig, method: Method, {err, output}: ResponseChunk): Buffer {
  if (err) {
    return encodeResponseError(err);
  }
  let data = Buffer.alloc(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let type: Type<any>;
  switch (method) {
    case Method.Status:
      type = config.types.Status;
      break;
    case Method.Goodbye:
      type = config.types.Goodbye;
      break;
    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      type = config.types.SignedBeaconBlock;
      break;
    default:
      throw new Error(`Unhandled method ${method}`);
  }
  data = Buffer.from(type.serialize(output));
  return encodeSingleChunk(data);
}

export function decodeResponseChunk(config: IBeaconConfig, method: Method, chunk: Buffer): ResponseChunk {
  const code = chunk[0];
  if (code !== 0) {
    throw new Error(chunk.slice(1).toString("utf8"));
  }
  const length = varint.decode(chunk, 1);
  const bytes = varint.decode.bytes;
  if (
    length !== chunk.length - (bytes + 1) ||
    length > MAX_CHUNK_SIZE
  ) {
    throw new Error(ERR_INVALID_REQ);
  }
  const data = chunk.slice(bytes + 1);
  let output: Status | Goodbye | SignedBeaconBlock;
  switch (method) {
    case Method.Status:
      output = config.types.Status.deserialize(data);
      break;
    case Method.Goodbye:
      output = config.types.Goodbye.deserialize(data);
      break;
    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      output = config.types.SignedBeaconBlock.deserialize(data);
      break;
    default:
      throw new Error(`Unhandled method ${method}`);
  }
  return {output};
}

function encodeResponseError(err: Error): Buffer {
  const b = Buffer.from("c" + "error_message:" + err.message);
  b[0] = err.message === ERR_INVALID_REQ ? 1 : 2;
  return b;
}

function encodeSingleChunk(data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.alloc(1),
    Buffer.from(varint.encode(data.length)),
    data,
  ]);
}
