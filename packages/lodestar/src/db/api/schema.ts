/**
 * @module db/schema
 */
import {intToBytes} from "@chainsafe/lodestar-utils";

// Buckets are separate database namespaces
export enum Bucket {
  // beacon chain
  // every state
  state, // Root -> BeaconState
  // unfinalized blocks
  block, // Root -> SignedBeaconBlock
  // finalized blocks
  blockArchive, // Slot -> SignedBeaconBlock
  blockArchiveParentRootIndex, // parent Root -> Slot
  blockArchiveRootRef, // Root -> Slot
  // known bad block
  invalidBlock, // Root -> boolean
  // finalized chain
  mainChain, // Slot -> Root<BeaconBlock>
  // justified, finalized state and block hashes
  chainInfo, // Key -> Number64 | stateHash | blockHash
  // eth1 processing
  eth1Data, // timestamp -> Eth1Data
  depositDataRoot, // depositIndex -> Root<DepositData>
  // op pool
  attestation, // Root -> Attestation
  aggregateAndProof, // Root -> AggregateAndProof
  depositData, // index -> DepositData
  exit, // ValidatorIndex -> VoluntaryExit
  proposerSlashing, // ValidatorIndex -> ProposerSlashing
  attesterSlashing, // Root -> AttesterSlashing
  // validator
  validator,
  lastProposedBlock,
  proposedAttestations,
}

export enum Key {
  chainHeight,

  latestState,
  finalizedState,
  justifiedState,

  finalizedBlock,
  justifiedBlock,
}

/**
 * Prepend a bucket to a key
 */
export function encodeKey(
  bucket: Bucket,
  key: Uint8Array | string | number | bigint,
): Buffer {
  let buf;
  if (typeof key === "string") {
    buf = Buffer.alloc(key.length + 1);
    buf.write(key, 1);
  } else if (typeof key === "number" || typeof key === "bigint") {
    buf = Buffer.alloc(9);
    intToBytes(BigInt(key), 8, "be").copy(buf, 1);
  } else {
    buf = Buffer.alloc(key.length + 1);
    buf.set(key, 1);
  }
  buf.writeUInt8(bucket, 0);
  return buf;
}
