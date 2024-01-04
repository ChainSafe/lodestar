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

  // op pool
  // phase0_attestation = 10, // DEPRECATED on v0.25.0
  // phase0_aggregateAndProof = 11, // Root -> AggregateAndProof, DEPRECATED on v.27.0
  phase0_depositData = 12, // [DEPRECATED] index -> DepositData
  phase0_exit = 13, // ValidatorIndex -> VoluntaryExit
  phase0_proposerSlashing = 14, // ValidatorIndex -> ProposerSlashing
  phase0_attesterSlashing = 15, // Root -> AttesterSlashing
  capella_blsToExecutionChange = 16, // ValidatorIndex -> SignedBLSToExecutionChange
  // checkpoint states
  allForks_checkpointState = 17, // Root -> allForks.BeaconState

  // allForks_pendingBlock = 25, // Root -> SignedBeaconBlock // DEPRECATED on v0.30.0
  phase0_depositEvent = 19, // depositIndex -> DepositEvent

  index_stateArchiveRootIndex = 26, // State Root -> slot

  allForks_blobSidecars = 27, // DENEB BeaconBlockRoot -> BlobSidecars
  allForks_blobSidecarsArchive = 28, // DENEB BeaconBlockSlot -> BlobSidecars

  phase0_preGenesisState = 30, // Single = phase0.BeaconState
  phase0_preGenesisStateLastProcessedBlock = 31, // Single = Uint8

  // Lightclient server
  // altair_bestUpdatePerCommitteePeriod = 30, // DEPRECATED on v0.32.0
  // altair_latestFinalizedUpdate = 31, // DEPRECATED on v0.32.0
  // altair_latestNonFinalizedUpdate = 32, // DEPRECATED on v0.32.0
  // altair_lightclientFinalizedCheckpoint = 33, // DEPRECATED on v0.32.0
  // altair_lightClientInitProof = 34, // DEPRECATED on v0.32.0
  // altair_lightClientSyncCommitteeProof = 35, // DEPRECATED on v0.32.0
  // index_lightClientInitProof = 36, // DEPRECATED on v0.32.0

  backfilled_ranges = 42, // Backfilled From to To, inclusive of both From, To

  // Buckets to support LightClient server v2
  lightClient_syncCommitteeWitness = 51, // BlockRoot -> SyncCommitteeWitness
  lightClient_syncCommittee = 52, // Root(altair.SyncCommittee) -> altair.SyncCommittee
  // TODO: May be redundant to block stores
  lightClient_checkpointHeader = 53, // BlockRoot -> phase0.BeaconBlockHeader
  // 54 was for bestPartialLightClientUpdate, allocate a fresh one
  // lightClient_bestLightClientUpdate = 55, // SyncPeriod -> LightClientUpdate // DEPRECATED on v1.5.0
  lightClient_bestLightClientUpdate = 56, // SyncPeriod -> [Slot, LightClientUpdate]
}

export function getBucketNameByValue<T extends Bucket>(enumValue: T): keyof typeof Bucket {
  const keys = Object.keys(Bucket).filter((x) => {
    if (isNaN(parseInt(x))) {
      return Bucket[x as keyof typeof Bucket] == enumValue;
    } else {
      return false;
    }
  }) as (keyof typeof Bucket)[];
  if (keys.length > 0) {
    return keys[0];
  }
  throw new Error("Missing bucket for value " + enumValue);
}
