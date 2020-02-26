/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @module network
 */

import PeerId from "peer-id";
import PeerInfo from "peer-info";
import {BasicType, ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, RequestId} from "../constants";

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
  return await PeerId.create({bits: 256, keyType: "secp256k1"});
}

export async function initializePeerInfo(peerId: PeerId, multiaddrs: string[]): Promise<PeerInfo> {
  const peerInfo = await createPeerInfo(peerId);
  multiaddrs.forEach((ma) => peerInfo.multiaddrs.add(ma));
  return peerInfo;
}

export function getRequestMethodSSZType(
  config: IBeaconConfig, method: Method
): ContainerType<any>|BasicType<any> {
  let type: ContainerType<any>|BasicType<any>;
  switch (method) {
    case Method.Status:
      type = config.types.Status;
      break;
    case Method.Goodbye:
      type = config.types.Goodbye;
      break;
    case Method.BeaconBlocksByRange:
      type = config.types.BeaconBlocksByRangeRequest;
      break;
    case Method.BeaconBlocksByRoot:
      type = config.types.BeaconBlocksByRootRequest;
      break;
  }
  return type;
}

export function getResponseMethodSSZType(
  config: IBeaconConfig, method: Method
): ContainerType<any>|BasicType<any> {
  let type: ContainerType<any>|BasicType<any>;
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
  }
  return type;
}