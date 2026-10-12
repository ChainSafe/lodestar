// biome-ignore-all lint/style/useNamingConvention: spec-canonical fork names in `ForkName`

interface BeaconBlockHeader {
  slot: number;
  proposerIndex: number;
  parentRoot: Uint8Array;
  stateRoot: Uint8Array;
  bodyRoot: Uint8Array;
}

interface Checkpoint {
  epoch: number;
  root: Uint8Array;
}

export interface VoluntaryExit {
  epoch: number;
  validatorIndex: number;
}

export interface SignedVoluntaryExit {
  message: VoluntaryExit;
  signature: Uint8Array;
}

interface Eth1Data {
  depositRoot: Uint8Array;
  depositCount: bigint;
  blockHash: Uint8Array;
}

interface ExecutionPayloadHeader {
  parentHash: Uint8Array;
  feeRecipient: Uint8Array;
  stateRoot: Uint8Array;
  receiptsRoot: Uint8Array;
  logsBloom: Uint8Array;
  prevRandao: Uint8Array;
  blockNumber: number;
  gasLimit: number;
  gasUsed: number;
  timestamp: number;
  extraData: Uint8Array;
  baseFeePerGas: bigint;
  blockHash: Uint8Array;
  transactionsRoot: Uint8Array;
  withdrawalsRoot?: Uint8Array; // capella+
  blobGasUsed?: bigint; // deneb+
  excessBlobGas?: bigint; // deneb+
}

/*
 * We don't need *all* the fields to check if a block
 * is a pre-merge or a merge transition block, so we just
 * have a minimum interface that is like a `BeaconBlock`.
 */
interface BeaconBlockLike {
  body: {
    randaoReveal: Uint8Array;
    executionPayload?: {
      parentHash: Uint8Array;
      feeRecipient: Uint8Array;
      stateRoot: Uint8Array;
      receiptsRoot: Uint8Array;
      logsBloom: Uint8Array;
      prevRandao: Uint8Array;
      blockNumber: number;
      gasLimit: number;
      gasUsed: number;
      timestamp: number;
      extraData: Uint8Array;
      baseFeePerGas: bigint;
      blockHash: Uint8Array;
      transactions: Uint8Array[];
    };
    executionPayloadHeader?: ExecutionPayloadHeader;
  };
}

interface Fork {
  previousVersion: Uint8Array;
  currentVersion: Uint8Array;
  epoch: number;
}

export enum ForkName {
  phase0 = "phase0",
  altair = "altair",
  bellatrix = "bellatrix",
  capella = "capella",
  deneb = "deneb",
  electra = "electra",
  fulu = "fulu",
  gloas = "gloas",
}

export enum ForkSeq {
  phase0 = 0,
  altair = 1,
  bellatrix = 2,
  capella = 3,
  deneb = 4,
  electra = 5,
  fulu = 6,
  gloas = 7,
}

interface SyncCommittee {
  pubkeys: Uint8Array[];
  aggregatePubkey: Uint8Array;
}

export interface ProcessSlotsOpts {
  /** Default: false (cache is transferred). Set to true to opt out of cache transfer. */
  dontTransferCache?: boolean;
}

interface CompactMultiProof {
  // biome-ignore lint/suspicious/noExplicitAny: native returns string literal "compactMulti", IBeaconStateView uses @chainsafe/persistent-merkle-tree's ProofType
  // TODO(bing): align types?
  type: any;
  leaves: Uint8Array[];
  descriptor: Uint8Array;
}

/**
 * Options to control how state transition is run.
 *
 * Note: Fields used by TS `StateTransitionOpts` but ignored by the Zig binding (e.g.
 * `executionPayloadStatus`) are silently dropped - they are declared here to pass type checks.
 */
export interface TransitionOpts {
  /** Verify the post-state root matches the block's state root. Default: true. */
  verifyStateRoot?: boolean;
  /** Verify the proposer signature on the signed block. Default: true. */
  verifyProposer?: boolean;
  /** Verify BLS signatures during block processing. Default: true. */
  verifySignatures?: boolean;
  /** Default: false (cache is transferred). Set to true to opt out of cache transfer. */
  dontTransferCache?: boolean;
  /** Source of block processing for the process-block timing metric. Default: "block". */
  source?: "block" | "regen" | "get_historical_state";
}

interface ProposerRewards {
  attestations: number;
  syncAggregate: number;
  slashing: number;
}

interface BlockRewards {
  proposerIndex: number;
  total: number;
  attestations: number;
  syncAggregate: number;
  proposerSlashings: number;
  attesterSlashings: number;
}

interface SyncCommitteeCache {
  validatorIndices: Uint32Array;
  validatorIndexMap: Map<number, number[]>;
}

interface EpochShuffling {
  epoch: number;
  activeIndices: Uint32Array;
  shuffling: Uint32Array;
  /** committees[slotInEpoch][committeeIndex] -> validator indices */
  committees: Uint32Array[][];
  committeesPerSlot: number;
}

interface HistoricalSummary {
  blockSummaryRoot: Uint8Array;
  stateSummaryRoot: Uint8Array;
}

interface Validator {
  pubkey: Uint8Array;
  withdrawalCredentials: Uint8Array;
  effectiveBalance: number;
  slashed: boolean;
  activationEligibilityEpoch: number;
  activationEpoch: number;
  exitEpoch: number;
  withdrawableEpoch: number;
}

type ValidatorStatus =
  | "pending_initialized"
  | "pending_queued"
  | "active_ongoing"
  | "active_exiting"
  | "active_slashed"
  | "exited_unslashed"
  | "exited_slashed"
  | "withdrawal_possible"
  | "withdrawal_done";

export type VoluntaryExitValidity =
  | "valid"
  | "inactive"
  | "already_exited"
  | "early_epoch"
  | "short_time_active"
  | "pending_withdrawals"
  | "invalid_signature";

export declare class BeaconStateView {
  /** Requires state bytes with trusted provenance; SSZ decoding does not authenticate them. */
  static createFromBytes(bytes: Uint8Array, config: BeaconConfig): BeaconStateView;

  /**
   * Idempotently release this view. Subsequent state access throws InvalidState.
   * An already-running native call retains its resources until that call returns.
   */
  release(): void;
  slot: number;
  fork: Fork;
  forkName: ForkName;
  forkSeq: ForkSeq;
  epoch: number;
  genesisTime: number;
  genesisValidatorsRoot: Uint8Array;
  eth1Data: Eth1Data;
  latestBlockHeader: BeaconBlockHeader;
  previousJustifiedCheckpoint: Checkpoint;
  currentJustifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
  getBlockRoot(epoch: number): Uint8Array;
  getBlockRootAtSlot(slot: number): Uint8Array;
  getBlockRootAtEpoch(epoch: number): Uint8Array;
  getStateRootAtSlot(slot: number): Uint8Array;
  getRandaoMix(epoch: number): Uint8Array;
  previousEpochParticipation: Uint8Array;
  currentEpochParticipation: Uint8Array;
  getPreviousEpochParticipation(index: number): number;
  getCurrentEpochParticipation(index: number): number;
  latestExecutionPayloadHeader: ExecutionPayloadHeader;
  payloadBlockNumber: number;
  historicalSummaries: HistoricalSummary[];
  pendingDeposits: Uint8Array;
  pendingDepositsCount: number;
  pendingPartialWithdrawals: Uint8Array;
  pendingPartialWithdrawalsCount: number;
  pendingConsolidations: Uint8Array;
  pendingConsolidationsCount: number;
  proposerLookahead: Uint32Array;
  // executionPayloadAvailability: boolean[];

  // Gloas-only — throw "not available before Gloas" when called pre-Gloas.
  latestBlockHash: Uint8Array;
  // TODO(bing): type this once we support gloas
  // biome-ignore lint/suspicious/noExplicitAny: gloas stub
  executionPayloadAvailability: any;
  // TODO(bing): type this once we support gloas
  // biome-ignore lint/suspicious/noExplicitAny: gloas stub
  latestExecutionPayloadBid: any;
  // TODO(bing): type this once we support gloas
  // biome-ignore lint/suspicious/noExplicitAny: gloas stub
  payloadExpectedWithdrawals: any[];
  // TODO(bing): type this once we support gloas
  // biome-ignore lint/suspicious/noExplicitAny: gloas stub
  getBuilder(index: number): any;
  canBuilderCoverBid(builderIndex: number, bidAmount: number): boolean;
  getEpochPTCs(epoch: number): Uint32Array[];
  getIndexInPayloadTimelinessCommittee(validatorIndex: number, slot: number): number;
  // TODO(bing): type this once we support gloas
  // biome-ignore lint/suspicious/noExplicitAny: gloas stub
  getExpectedWithdrawalsForFullParent(executionRequests: any): any[];
  // TODO(bing): Implement when we support gloas
  // biome-ignore lint/suspicious/noExplicitAny: gloas stub
  withParentPayloadApplied(executionRequests: any): BeaconStateView;

  getShufflingAtEpoch(epoch: number): EpochShuffling;
  getPreviousShuffling(): EpochShuffling;
  getCurrentShuffling(): EpochShuffling;
  getNextShuffling(): EpochShuffling;
  getBeaconCommittee(slot: number, index: number): Uint32Array;
  getBeaconCommitteeCountPerSlot(epoch: number): number;
  previousDecisionRoot: string;
  currentDecisionRoot: string;
  nextDecisionRoot: string;
  getShufflingDecisionRoot(epoch: number): string;
  previousProposers: number[] | null;
  currentProposers: number[];
  nextProposers: number[];
  getBeaconProposer(slot: number): number;
  getBeaconProposerOrNull(slot: number): number | null;
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
  currentSyncCommitteeIndexed: SyncCommitteeCache;
  /** Returns an owned copy in committee order, including repeated validators. */
  readonly currentSyncCommitteeValidatorIndices: Uint32Array;
  syncProposerReward: number;
  getIndexedSyncCommitteeAtEpoch(epoch: number): SyncCommitteeCache;
  getIndexedSyncCommittee(slot: number): SyncCommitteeCache;

  effectiveBalanceIncrements: Uint16Array;
  getEffectiveBalanceIncrementsZeroInactive(): Uint16Array;
  getBalance(index: number): number;
  getValidator(index: number): Validator;
  getAllValidators(): Validator[];
  getBuildersLength(): number;
  getAllBalances(): number[];
  getValidatorsByStatus(statuses: Set<string>, currentEpoch: number): Validator[];
  // TODO wrong function
  getValidatorStatus(index: number): ValidatorStatus;
  validatorCount: number;
  activeValidatorCount: number;

  isExecutionStateType: boolean;
  isMergeTransitionComplete: boolean;
  /**
   * Check whether execution is enabled for the given block at this state.
   *
   * For normal post-merge operation this short-circuits from state alone and does
   * not inspect `block`. The block object is only read for the historical pre-merge
   * Bellatrix case, where execution is enabled iff the block carries the first
   * non-default execution payload.
   */
  isExecutionEnabled(block: BeaconBlockLike): boolean;

  proposerRewards: ProposerRewards;
  computeBlockRewards(
    signedBlockBytes: Uint8Array,
    isBlinded: boolean,
    proposerRewards?: ProposerRewards
  ): BlockRewards;
  computeAttestationsRewards(validatorIds?: (number | string)[]): AttestationsRewards;
  computeSyncCommitteeRewards(
    block: SyncCommitteeRewardsBlock,
    validatorIds?: (number | string)[]
  ): SyncCommitteeReward[];
  getLatestWeakSubjectivityCheckpointEpoch(): number;

  getVoluntaryExitValidity(signedVoluntaryExit: SignedVoluntaryExit, verifySignature: boolean): VoluntaryExitValidity;
  isValidVoluntaryExit(signedVoluntaryExit: SignedVoluntaryExit, verifySignature: boolean): boolean;

  getFinalizedRootProof(): Uint8Array[];
  getSyncCommitteesWitness(): {
    witness: Uint8Array[];
    currentSyncCommitteeRoot: Uint8Array;
    nextSyncCommitteeRoot: Uint8Array;
  };
  getSingleProof(gindex: bigint): Uint8Array[];
  /**
   * Compute expected withdrawals for the next payload (capella+).
   *
   * processedBuilderWithdrawalsCount is withdrawals coming from builder payment since gloas (EIP-7732)
   * processedPartialWithdrawalsCount is withdrawals coming from EL since electra (EIP-7002)
   * processedBuildersSweepCount is withdrawals from builder sweep since gloas (EIP-7732)
   * processedValidatorSweepCount is withdrawals coming from validator sweep

   * TODO(bing): `processedBuilderWithdrawalsCount` and `processedBuildersSweepCount` are Gloas-only
   * and always 0 here since Zig STF doesn't process Gloas yet.
   */
  getExpectedWithdrawals(): {
    expectedWithdrawals: {index: number; validatorIndex: number; address: Uint8Array; amount: bigint}[];
    processedBuilderWithdrawalsCount: number;
    processedPartialWithdrawalsCount: number;
    processedBuildersSweepCount: number;
    processedValidatorSweepCount: number;
  };

  /** On phase0, serialize this call with other STF operations and cache teardown within this thread. */
  computeUnrealizedCheckpoints(): {
    justifiedCheckpoint: Checkpoint;
    finalizedCheckpoint: Checkpoint;
  };
  computeAnchorCheckpoint(): {
    checkpoint: Checkpoint;
    blockHeader: BeaconBlockHeader;
  };

  clonedCount: number;
  clonedCountWithTransferCache: number;
  createdWithTransferCache: boolean;
  isStateValidatorsNodesPopulated(): boolean;

  loadOtherState(
    stateBytes: Uint8Array,
    seedValidatorsBytes?: Uint8Array,
    opts?: {preloadValidatorsAndBalances?: boolean}
  ): BeaconStateView;
  loadOtherStateBench(stateBytes: Uint8Array, seedValidatorsBytes?: Uint8Array): void;
  // biome-ignore lint/suspicious/noExplicitAny: structurally a BeaconState (fork-narrowed),
  // but typing the union here would duplicate types from @lodestar/types. Caller narrows by forkName.
  toValue(): any;

  serialize(): Uint8Array;
  serializedSize(): number;
  /** Takes a `@chainsafe/ssz` ByteViews `{uint8Array, dataView}`; native uses `uint8Array` only. */
  serializeToBytes(output: {uint8Array: Uint8Array; dataView: DataView}, offset: number): number;
  serializeValidators(): Uint8Array;
  serializedValidatorsSize(): number;
  serializeValidatorsToBytes(output: {uint8Array: Uint8Array; dataView: DataView}, offset: number): number;
  hashTreeRoot(): Uint8Array;
  createMultiProof(descriptor: Uint8Array): CompactMultiProof;

  /** Serialize this call with other STF operations and cache teardown within this thread. */
  processSlots(slot: number, options?: ProcessSlotsOpts): BeaconStateView;
  /** Serialize this call with other STF operations and cache teardown within this thread. */
  stateTransition(signedBlockBytes: Uint8Array, isBlinded: boolean, options?: TransitionOpts): BeaconStateView;
}

/**
 * Owns a copy of the configuration inputs; states retain it for their lifetime.
 * Numeric u64 fields accept safe unsigned integers or Infinity as the maximum u64 sentinel.
 */
export declare class BeaconConfig {
  private readonly _brand: void;
  constructor(chainConfig: object, genesisValidatorsRoot: Uint8Array);
}

declare const bindings: {
  stateTransition: {
    /** Callers must exclude STF operations in this thread until teardown returns. */
    deinitReusedEpochTransitionCache: () => void;
  };
  metrics: {
    init: (options?: {historical?: boolean}) => void;
    scrapeMetrics: () => string;
    registerLocalValidator: (index: number) => void;
    unregisterLocalValidator: (index: number) => void;
  };
  BeaconStateView: typeof BeaconStateView;
  BeaconConfig: typeof BeaconConfig;
};

export default bindings;

export interface SyncCommitteeRewardsBlock {
  slot: number;
  body: {
    randaoReveal: Uint8Array;
    syncAggregate?: {
      syncCommitteeBits: {uint8Array: Uint8Array; bitLen: number};
    };
  };
}

export interface SyncCommitteeReward {
  validatorIndex: number;
  reward: number;
}

export interface AttestationReward {
  head: number;
  target: number;
  source: number;
  inclusionDelay: number;
  inactivity: number;
}

export interface IdealAttestationsReward extends AttestationReward {
  effectiveBalance: number;
}

export interface TotalAttestationsReward extends AttestationReward {
  validatorIndex: number;
}

export interface AttestationsRewards {
  idealRewards: IdealAttestationsReward[];
  totalRewards: TotalAttestationsReward[];
}
