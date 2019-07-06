import {Shard} from "@chainsafe/eth2-types";
import {RequestId, SHARD_SUBNET_COUNT, SHARD_ATTESTATION_TOPIC} from "@chainsafe/eth2-types"

function randomNibble(): string {
  return Math.floor(Math.random() * 16).toString(16);
}

export function randomRequestId(): RequestId {
  return Array.from({length: 16}, () => randomNibble()).join('');
}

export function shardSubnetAttestationTopic(shard: Shard): string {
  return SHARD_ATTESTATION_TOPIC.replace("{shard}", String(shard % SHARD_SUBNET_COUNT));
}
export function shardAttestationTopic(shard: Shard): string {
  return SHARD_ATTESTATION_TOPIC.replace("{shard}", String(shard));
}
