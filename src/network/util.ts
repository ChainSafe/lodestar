import {Shard} from "../types";
import {SHARD_SUBNET_COUNT} from "./constants";
import {RequestId} from "./codec";

function randomNibble(): string {
  return Math.floor(Math.random() * 16).toString(16);
}

export function randomRequestId(): RequestId {
  return Array.from({length: 16}, () => randomNibble()).join('');
}

export function shardSubnetAttestationTopic(shard: Shard): string {
  return `shard${shard % SHARD_SUBNET_COUNT}_attestation`;
}
export function shardAttestationTopic(shard: Shard): string {
  return `shard${shard}_attestation`;
}
