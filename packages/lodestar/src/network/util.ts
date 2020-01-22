/**
 * @module network
 */

import PeerId from "peer-id";
import PeerInfo from "peer-info";
import {RequestId, Method, MAX_CHUNK_SIZE, ERR_INVALID_REQ} from "../constants";
import {ResponseBody, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {serialize, deserialize} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import * as varint from "varint";

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

export function encodeChunkifyResponse(config: IBeaconConfig, method: Method, body: ResponseBody): Buffer {
  let output= Buffer.alloc(0);
  switch (method) {
    case Method.Status:
      output = serialize(config.types.Status, body);
      return encodeSingleChunk(output);
    case Method.Goodbye:
      output = serialize(config.types.Goodbye, body);
      return encodeSingleChunk(output);
    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      return encodeBlockChunks(config, body as SignedBeaconBlock[]);
  }
}

export function decodeChunkifyResponse(config: IBeaconConfig, method: Method, chunks: Buffer): ResponseBody {
  switch (method) {
    case Method.Status:
    case Method.Goodbye:
      return decodeSingleChunk(config, method, chunks) as ResponseBody;
    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      return decodeBlockChunks(config, method, chunks);
  }
}

function encodeBlockChunks(config: IBeaconConfig, blocks: SignedBeaconBlock[]): Buffer {
  const chunkArr = blocks.map(block => encodeSingleChunk(serialize(config.types.SignedBeaconBlock, block)));
  return Buffer.concat(chunkArr);
}

function encodeSingleChunk(data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.alloc(1),
    Buffer.from(varint.encode(data.length)),
    data,
  ]);
}

function decodeBlockChunks(config: IBeaconConfig, method: Method, chunks: Buffer): SignedBeaconBlock[] {
  let chunkIndex = 0;
  const count = chunks.length;
  const result: SignedBeaconBlock[] = [];
  if (count <= 1) {
    throw new Error(chunks.toString("utf8"));
  }
  while(chunkIndex < count) {
    const length = varint.decode(chunks, chunkIndex + 1);
    const bytes = varint.decode.bytes;
    const nextChunkIndex = chunkIndex + 1 + bytes + length;
    const chunk = chunks.slice(chunkIndex, nextChunkIndex);
    const block = decodeSingleChunk(config, method, chunk) as SignedBeaconBlock;
    result.push(block);
    chunkIndex = nextChunkIndex;
  }
  return result;
}

function decodeSingleChunk(config: IBeaconConfig, method: Method, chunk: Buffer): ResponseBody | SignedBeaconBlock {
  const code = chunk[0];
  const length = varint.decode(chunk, 1);
  const bytes = varint.decode.bytes;
  if (
    length !== chunk.length - (bytes + 1) ||
    length > MAX_CHUNK_SIZE
  ) {
    throw new Error(ERR_INVALID_REQ);
  }
  const data = chunk.slice(bytes + 1);
  if (code !== 0) {
    throw new Error(data.toString("utf8"));
  }
  switch (method) {
    case Method.Status:
      return deserialize(config.types.Status, data);
    case Method.Goodbye:
      return deserialize(config.types.Goodbye, data);
    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      return deserialize(config.types.SignedBeaconBlock, data);
  }
}
