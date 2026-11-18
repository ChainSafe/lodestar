import {digest} from "@chainsafe/as-sha256";
import {ChainConfig} from "@lodestar/config";
import {ATTESTATION_SUBNET_COUNT, ATTESTATION_SUBNET_PREFIX_BITS, NODE_ID_BITS} from "@lodestar/params";
import {computeShuffledIndex} from "@lodestar/state-transition";
import {Epoch, ssz} from "@lodestar/types";
import {NodeId} from "./interface.js";

/**
 * Spec https://github.com/ethereum/consensus-specs/blob/v1.4.0-alpha.3/specs/phase0/p2p-interface.md
 */
export function computeSubscribedSubnet(config: ChainConfig, nodeId: NodeId, epoch: Epoch): number[] {
  const subnets: number[] = [];
  for (let index = 0; index < config.SUBNETS_PER_NODE; index++) {
    subnets.push(computeSubscribedSubnetByIndex(config, nodeId, epoch, index));
  }
  return subnets;
}

/**
 * Spec https://github.com/ethereum/consensus-specs/blob/v1.4.0-alpha.3/specs/phase0/p2p-interface.md
 */
export function computeSubscribedSubnetByIndex(
  config: ChainConfig,
  nodeId: NodeId,
  epoch: Epoch,
  index: number
): number {
  // From pq there are fewer subnets, so the prefix that picks one is shorter
  const isPq = epoch >= config.PQ_FORK_EPOCH && epoch < config.HEZE_FORK_EPOCH;
  const subnetCount = isPq ? config.ATTESTATION_SUBNET_COUNT_PQ : ATTESTATION_SUBNET_COUNT;
  const prefixBits = ATTESTATION_SUBNET_PREFIX_BITS - Math.log2(ATTESTATION_SUBNET_COUNT / subnetCount);
  const nodeIdPrefix = getNodeIdPrefix(nodeId, prefixBits);
  const nodeOffset = getNodeOffset(nodeId);
  const permutationSeed = digest(
    ssz.UintNum64.serialize(Math.floor((epoch + nodeOffset) / config.EPOCHS_PER_SUBNET_SUBSCRIPTION))
  );
  const permutatedPrefix = computeShuffledIndex(nodeIdPrefix, 1 << prefixBits, permutationSeed);
  return (permutatedPrefix + index) % subnetCount;
}

/**
 * Should return node_id >> (NODE_ID_BITS - int(ATTESTATION_SUBNET_PREFIX_BITS))
 * Ideally we should use bigint here but since these constants are not likely to change we can use number
 */
export function getNodeIdPrefix(nodeId: NodeId, prefixBits = ATTESTATION_SUBNET_PREFIX_BITS): number {
  const totalShiftedBits = NODE_ID_BITS - prefixBits;
  const shiftedBytes = Math.floor(totalShiftedBits / 8);
  const shiftedBits = totalShiftedBits % 8;
  const prefixBytes = nodeId.slice(0, nodeId.length - shiftedBytes);
  const dataView = new DataView(prefixBytes.buffer, prefixBytes.byteOffset, prefixBytes.byteLength);
  // only 6 bits are used for prefix so getUint8() is safe
  const prefix = dataView.getUint8(0) >> shiftedBits;
  return prefix;
}

/**
 * Should return node_offset = node_id % EPOCHS_PER_SUBNET_SUBSCRIPTION
 * This function is safe to return number because EPOCHS_PER_SUBNET_SUBSCRIPTION is 256
 */
export function getNodeOffset(nodeId: NodeId): number {
  // Big endian means that the least significant byte comes last
  // The n % 256 is equivalent to the last byte of the node_id
  const lastByte = nodeId.at(-1);
  if (lastByte === undefined) throw new Error("Can not get node offset");

  return lastByte;
}
