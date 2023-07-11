import {digest} from "@chainsafe/as-sha256";
import {
  ATTESTATION_SUBNET_PREFIX_BITS,
  EPOCHS_PER_SUBNET_SUBSCRIPTION,
  NODE_ID_BITS,
  SUBNETS_PER_NODE,
} from "@lodestar/params";
import {ATTESTATION_SUBNET_COUNT} from "@lodestar/params";
import {computeShuffledIndex} from "@lodestar/state-transition";
import {Epoch, ssz} from "@lodestar/types";
import {NodeId} from "./interface.js";

/**
 * Spec https://github.com/ethereum/consensus-specs/blob/v1.4.0-alpha.3/specs/phase0/p2p-interface.md
 */
export function computeSubscribedSubnet(nodeId: NodeId, epoch: Epoch): number[] {
  const subnets: number[] = [];
  for (let index = 0; index < SUBNETS_PER_NODE; index++) {
    subnets.push(computeSubscribedSubnetByIndex(nodeId, epoch, index));
  }
  return subnets;
}

/**
 * Spec https://github.com/ethereum/consensus-specs/blob/v1.4.0-alpha.3/specs/phase0/p2p-interface.md
 */
export function computeSubscribedSubnetByIndex(nodeId: NodeId, epoch: Epoch, index: number): number {
  const nodeIdPrefix = getNodeIdPrefix(nodeId);
  const nodeOffset = getNodeOffset(nodeId);
  const permutationSeed = digest(
    ssz.UintNum64.serialize(Math.floor((epoch + nodeOffset) / EPOCHS_PER_SUBNET_SUBSCRIPTION))
  );
  const permutatedPrefix = computeShuffledIndex(nodeIdPrefix, 1 << ATTESTATION_SUBNET_PREFIX_BITS, permutationSeed);
  return (permutatedPrefix + index) % ATTESTATION_SUBNET_COUNT;
}

/**
 * Should return node_id >> (NODE_ID_BITS - int(ATTESTATION_SUBNET_PREFIX_BITS))
 * Ideally we should use bigint here but since these constants are not likely to change we can use number
 */
export function getNodeIdPrefix(nodeId: NodeId): number {
  const totalShiftedBits = NODE_ID_BITS - ATTESTATION_SUBNET_PREFIX_BITS;
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
  return nodeId[nodeId.length - 1];
}
