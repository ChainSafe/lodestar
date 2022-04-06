/**
 * @module db/schema
 */
import {intToBytes} from "@chainsafe/lodestar-utils";
import {BUCKET_LENGTH} from "./const.js";

// Buckets are separate database namespaces
export enum Bucket {
  // beacon chain
  // finalized states
  allForks_stateArchive = 0, // Root -> phase0.BeaconState
  // unfinalized blocks
  allForks_block = 1, // Root -> phase0.SignedBeaconBlock
  // finalized blocks
  allForks_blockArchive = 2, // Slot -> phase0.SignedBeaconBlock
  // finalized block additional indices
  index_blockArchiveParentRootIndex = 3, // parent Root -> Slot
  index_blockArchiveRootIndex = 4, // Root -> Slot
  // known bad block
  // index_invalidBlock = 5, // DEPRECATED on v0.25.0
  // finalized chain
  index_mainChain = 6, // Slot -> Root<BeaconBlock>
  // justified, finalized state and block hashes
  index_chainInfo = 7, // Key -> Number64 | stateHash | blockHash
  // eth1 processing
  phase0_eth1Data = 8, // timestamp -> Eth1Data
  index_depositDataRoot = 9, // depositIndex -> Root<DepositData>
  phase0_depositEvent = 19, // depositIndex -> DepositEvent
  phase0_preGenesisState = 30, // Single = phase0.BeaconState
  phase0_preGenesisStateLastProcessedBlock = 31, // Single = Uint8
  // op pool
  // phase0_attestation = 10, // DEPRECATED on v0.25.0
  // phase0_aggregateAndProof = 11, // Root -> AggregateAndProof, DEPRECATED on v.27.0
  phase0_depositData = 12, // [DEPRECATED] index -> DepositData
  phase0_exit = 13, // ValidatorIndex -> VoluntaryExit
  phase0_proposerSlashing = 14, // ValidatorIndex -> ProposerSlashing
  phase0_attesterSlashing = 15, // Root -> AttesterSlashing
  // validator
  // validator = 16, // DEPRECATED on v0.11.0
  // lastProposedBlock = 17, // DEPRECATED on v0.11.0
  // proposedAttestations = 18, // DEPRECATED on v0.11.0
  // validator slashing protection
  phase0_slashingProtectionBlockBySlot = 20,
  phase0_slashingProtectionAttestationByTarget = 21,
  phase0_slashingProtectionAttestationLowerBound = 22,
  index_slashingProtectionMinSpanDistance = 23,
  index_slashingProtectionMaxSpanDistance = 24,
  // allForks_pendingBlock = 25, // Root -> SignedBeaconBlock // DEPRECATED on v0.30.0

  index_stateArchiveRootIndex = 26, // State Root -> slot

  // Lightclient server
  // altair_bestUpdatePerCommitteePeriod = 30, // DEPRECATED on v0.32.0
  // altair_latestFinalizedUpdate = 31, // DEPRECATED on v0.32.0
  // altair_latestNonFinalizedUpdate = 32, // DEPRECATED on v0.32.0
  // altair_lightclientFinalizedCheckpoint = 33, // DEPRECATED on v0.32.0
  // altair_lightClientInitProof = 34, // DEPRECATED on v0.32.0
  // altair_lightClientSyncCommitteeProof = 35, // DEPRECATED on v0.32.0
  // index_lightClientInitProof = 36, // DEPRECATED on v0.32.0

  // Buckets to support LightClient server v2
  lightClient_syncCommitteeWitness = 51, // BlockRoot -> SyncCommitteeWitness
  lightClient_syncCommittee = 52, // Root(altair.SyncCommittee) -> altair.SyncCommittee
  // TODO: May be redundant to block stores
  lightClient_checkpointHeader = 53, // BlockRoot -> phase0.BeaconBlockHeader
  lightClient_bestPartialLightClientUpdate = 54, // SyncPeriod -> PartialLightClientUpdate

  validator_metaData = 41,

  backfilled_ranges = 42, // Backfilled From to To, inclusive of both From, To
}

export enum Key {
  chainHeight = 0,

  latestState = 1,
  finalizedState = 2,
  justifiedState = 3,

  finalizedBlock = 4,
  justifiedBlock = 5,
}

export const uintLen = 8;

/**
 * Prepend a bucket to a key
 */
export function encodeKey(bucket: Bucket, key: Uint8Array | string | number | bigint): Uint8Array {
  let buf;
  const prefixLength = BUCKET_LENGTH;
  //all keys are writen with prefixLength offet
  if (typeof key === "string") {
    buf = Buffer.alloc(key.length + prefixLength);
    buf.write(key, prefixLength);
  } else if (typeof key === "number" || typeof key === "bigint") {
    buf = Buffer.alloc(uintLen + prefixLength);
    intToBytes(BigInt(key), uintLen, "be").copy(buf, prefixLength);
  } else {
    buf = Buffer.alloc(key.length + prefixLength);
    buf.set(key, prefixLength);
  }
  //bucket prefix on position 0
  buf.set(intToBytes(bucket, BUCKET_LENGTH, "le"), 0);
  return buf;
}
