/**
 * @module network
 */

import PeerId from "peer-id";
import PeerInfo from "peer-info";
import promisify from "promisify-es6";
import {Shard} from "@chainsafe/eth2.0-types";

import {RequestId, SHARD_SUBNET_COUNT, SHARD_ATTESTATION_TOPIC} from "../constants";

// req/resp

function randomNibble(): string {
  return Math.floor(Math.random() * 16).toString(16);
}

export function randomRequestId(): RequestId {
  return Array.from({length: 16}, () => randomNibble()).join('');
}

export function createResponseEvent(id: RequestId): string {
  return `response ${id}`;
}

const REQ_PROTOCOL = "/eth2/beacon_chain/req/{method}/{version}/{encoding}";
export function createRpcProtocol(method: string, encoding: string, version: number = 1) {
  return REQ_PROTOCOL
    .replace("{method}", method)
    .replace("{encoding}", encoding)
    .replace("{version}", String(version));
}

// gossip

export function shardSubnetAttestationTopic(shard: Shard): string {
  return SHARD_ATTESTATION_TOPIC.replace("{shard}", String(shard % SHARD_SUBNET_COUNT));
}
export function shardAttestationTopic(shard: Shard): string {
  return SHARD_ATTESTATION_TOPIC.replace("{shard}", String(shard));
}

// peers

/**
 * Return a fresh PeerInfo instance
 */
export async function createPeerInfo(peerId: PeerId): Promise<PeerInfo> {
  return await promisify(PeerInfo.create)(peerId);
}

/**
 * Return a fresh PeerId instance
 */
export async function createPeerId(): Promise<PeerId> {
  return await promisify(PeerId.create)({bits: 2048});
}

export async function initializePeerInfo(peerId: PeerId, multiaddrs: string[]): Promise<PeerInfo> {
  const peerInfo = await createPeerInfo(peerId);
  multiaddrs.forEach((ma) => peerInfo.multiaddrs.add(ma));
  return peerInfo;
}
