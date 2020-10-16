/**
 * @module db/schema
 */
import {intToBytes} from "@chainsafe/lodestar-utils";

// Buckets are separate database namespaces
export enum Bucket {
  // beacon chain
  // every state
  state = 0, // Root -> BeaconState
  // unfinalized blocks
  block = 1, // Root -> SignedBeaconBlock
  // finalized blocks
  blockArchive = 2, // Slot -> SignedBeaconBlock
  blockArchiveParentRootIndex = 3, // parent Root -> Slot
  blockArchiveRootIndex = 4, // Root -> Slot
  // known bad block
  invalidBlock = 5, // Root -> boolean
  // finalized chain
  mainChain = 6, // Slot -> Root<BeaconBlock>
  // justified, finalized state and block hashes
  chainInfo = 7, // Key -> Number64 | stateHash | blockHash
  // eth1 processing
  eth1Data = 8, // timestamp -> Eth1Data
  depositDataRoot = 9, // depositIndex -> Root<DepositData>
  depositEvent = 19, // depositIndex -> DepositEvent
  // op pool
  attestation = 10, // Root -> Attestation
  aggregateAndProof = 11, // Root -> AggregateAndProof
  depositData = 12, // [DEPRECATED] index -> DepositData
  exit = 13, // ValidatorIndex -> VoluntaryExit
  proposerSlashing = 14, // ValidatorIndex -> ProposerSlashing
  attesterSlashing = 15, // Root -> AttesterSlashing
  // validator
  // validator = 16, // DEPRECATED on v0.11.0
  // lastProposedBlock = 17, // DEPRECATED on v0.11.0
  // proposedAttestations = 18, // DEPRECATED on v0.11.0
  // validator slashing protection
  slashingProtectionBlockBySlot = 20,
  slashingProtectionAttestationByTarget = 21,
  slashingProtectionAttestationLowerBound = 22,
  slashingProtectionMinSpanDistance = 23,
  slashingProtectionMaxSpanDistance = 24,
}

export enum Key {
  chainHeight = 0,

  latestState = 1,
  finalizedState = 2,
  justifiedState = 3,

  finalizedBlock = 4,
  justifiedBlock = 5,
}

/**
 * Prepend a bucket to a key
 */
export function encodeKey(bucket: Bucket, key: Uint8Array | string | number | bigint): Buffer {
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
