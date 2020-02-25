/**
 * @module db/schema
 */
import {intToBytes} from "@chainsafe/lodestar-utils";

// Buckets are separate database namespaces
export enum Bucket {
  // beacon chain
  state, // hash -> BeaconState
  attestation, // hash -> Attestation
  aggregateAndProof, // hash -> AggregateAndProof
  block, // hash -> BeaconBlock
  blockArchive, // hash -> BeaconBlock
  blockSlotRefs,
  blockRootRefs,
  invalidBlock, // bad block
  mainChain, // slot -> blockHash
  chainInfo, // Key -> Number64 | stateHash | blockHash
  validator,
  depositData, // index -> DepositData
  exit, // hash -> VoluntaryExit
  proposerSlashing, // hash -> ProposerSlashing
  attesterSlashing, // hash -> AttesterSlashing
  depositDataRootList, // depositIndex -> DepositDataRootList
  // validator
  lastProposedBlock,
  proposedAttestations,
}

export enum BlockMapping {
  slotToRoot,
  rootToSlot
}

export enum Key {
  chainHeight,

  latestState,
  finalizedState,
  justifiedState,

  finalizedBlock,
  justifiedBlock,
  progressiveMerkleTree,
}

/**
 * Prepend a bucket to a key
 */
export function encodeKey(
  bucket: Bucket,
  key: Uint8Array | string | number | bigint,
  useBuffer = true
): Buffer | string {
  let buf;
  if (typeof key === "string") {
    buf = Buffer.alloc(key.length + 1);
    buf.write(key, 1);
  } else if (typeof key === "number" || typeof key === "bigint") {
    buf = Buffer.alloc(9);
    intToBytes(BigInt(key), 8).copy(buf, 1);
  } else {
    buf = Buffer.alloc(key.length + 1);
    buf.set(key, 1);
  }
  buf.writeUInt8(bucket, 0);
  return useBuffer ? buf : buf.toString("hex");
}
