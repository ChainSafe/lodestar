import {BitArray} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView, VoluntaryExitValidity} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  CommitteeIndex,
  Domain,
  Epoch,
  IndexedAttestation,
  Root,
  RootHex,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
  SubcommitteeIndex,
  SubnetID,
  ValidatorIndex,
  altair,
  bellatrix,
  capella,
  deneb,
  fulu,
  gloas,
  heze,
  phase0,
} from "@lodestar/types";
import {BlockType} from "../interface.js";
import {PooledExecutionPayloadBid} from "../opPools/executionPayloadBidPool.js";
import {InclusionListInsertOutcome} from "../opPools/inclusionListStore.js";
import {InsertOutcome} from "../opPools/types.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {AggregateAndProofValidationResult} from "../validation/aggregateAndProof.js";
import {
  ApiAttestation,
  AttestationValidationResult,
  BatchResult,
  GossipAttestation,
} from "../validation/attestation.js";
import {GossipBlockValidationResult} from "../validation/block.js";
import {ExecutionPayloadBidValidationResult} from "../validation/executionPayloadBid.js";
import {InclusionListValidationResult} from "../validation/inclusionList.js";
import {PayloadAttestationValidationResult} from "../validation/payloadAttestationMessage.js";
import {SyncCommitteeMessageValidationResult} from "../validation/syncCommittee.js";
import {ContributionAndProofValidationResult} from "../validation/syncCommitteeContributionAndProof.js";
import {ApiVoluntaryExitResult} from "../validation/voluntaryExit.js";

/**
 * Gossip topics whose validation, seen caches and pool writes can move to lodestar-z independently.
 * `attestation` and `aggregate` share `seenAttestationDatas` and must move together.
 */
export enum ValidationTopic {
  attestation = "attestation",
  aggregate = "aggregate",
  syncCommitteeMessage = "syncCommitteeMessage",
  contributionAndProof = "contributionAndProof",
  /** Attester and proposer slashings, voluntary exits and BLS changes share one pool, so they move together */
  operations = "operations",
  payloadAttestation = "payloadAttestation",
  executionPayloadBid = "executionPayloadBid",
  proposerPreferences = "proposerPreferences",
  inclusionList = "inclusionList",
  block = "block",
  executionPayloadEnvelope = "executionPayloadEnvelope",
  blobSidecar = "blobSidecar",
  dataColumnSidecar = "dataColumnSidecar",
}

export type ImportAttestationOpts = {
  /** Unaggregated attestations are pooled only on subnets this node aggregates for */
  addToPool: boolean;
  addToForkChoice: boolean;
  priority?: boolean;
};

/**
 * Validation together with the state it writes: seen caches, op pools and fork choice votes.
 * A native implementation applies an accepted message without a round trip through JS, so the import step
 * belongs to the same interface as the validation step.
 */
export interface IValidationEngine {
  /** Clock ticks and head changes drive pruning of the seen caches the engine owns */
  onSlot(slot: Slot): void;
  onEpoch(epoch: Epoch): void;
  onNewHead(headSlot: Slot): void;
  onFinalized(finalizedSlot: Slot): void;
  /** Release every cache and pool the engine holds. Nothing may be called after this. */
  close(): void;

  /**
   * Block verification and import report what they saw, so the seen caches shared with gossip validation have one
   * writer. `onBlockVerified` runs once the proposer signature is verified, also for a block that is only being
   * checked and may never be published. `onBlockImported` runs once the block is accepted for import.
   */
  onBlockVerified(signedBlock: SignedBeaconBlock, blockRootHex: RootHex): void;
  onBlockImported(block: BeaconBlock, blockRootHex: RootHex): void;
  /** Every attestation a block carries counts as seen for aggregate deduplication and liveness */
  onBlockAttestationImported(
    fork: ForkName,
    state: IBeaconStateView,
    blockEpoch: Epoch,
    target: phase0.Checkpoint,
    attDataRootHex: RootHex,
    attestation: Attestation,
    indexedAttestation: IndexedAttestation
  ): void;

  validateGossipAttestationsSameAttData(fork: ForkName, attestations: GossipAttestation[]): Promise<BatchResult>;
  validateApiAttestation(fork: ForkName, attestation: ApiAttestation): Promise<AttestationValidationResult>;
  /**
   * Pool insertion and the fork choice vote fail independently: a pool error must not skip the vote.
   * Returns null when the attestation was not pooled.
   */
  importAttestation(result: AttestationValidationResult, opts: ImportAttestationOpts): InsertOutcome | null;

  validateGossipAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof,
    serializedData: Uint8Array
  ): Promise<AggregateAndProofValidationResult>;
  validateApiAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<AggregateAndProofValidationResult>;
  importAggregateAndProof(
    signedAggregateAndProof: SignedAggregateAndProof,
    result: AggregateAndProofValidationResult,
    opts: {addToForkChoice: boolean}
  ): InsertOutcome;

  validateGossipSyncCommitteeMessage(
    message: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<SyncCommitteeMessageValidationResult>;
  validateApiSyncCommitteeMessage(message: altair.SyncCommitteeMessage): Promise<SyncCommitteeMessageValidationResult>;
  /** One outcome per position in `result`, a validator may hold several seats in a subcommittee */
  importSyncCommitteeMessage(
    message: altair.SyncCommitteeMessage,
    result: SyncCommitteeMessageValidationResult,
    opts: {priority?: boolean}
  ): InsertOutcome[];

  validateGossipContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<ContributionAndProofValidationResult>;
  validateApiContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<ContributionAndProofValidationResult>;
  importContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof,
    result: ContributionAndProofValidationResult,
    opts: {priority?: boolean}
  ): InsertOutcome;

  validateGossipAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<[Domain, Domain]>;
  validateApiAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<[Domain, Domain]>;
  importAttesterSlashing(
    fork: ForkName,
    attesterSlashing: AttesterSlashing,
    verifiedDomains: [Domain, Domain],
    opts: {addToForkChoice: boolean}
  ): void;

  validateGossipProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<Domain>;
  validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<Domain>;
  importProposerSlashing(proposerSlashing: phase0.ProposerSlashing, verifiedDomain: Domain): void;

  validateGossipVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void>;
  validateApiVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<ApiVoluntaryExitResult>;
  importVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): void;
  /**
   * Hold an exit whose only failing condition is transient until it becomes processable.
   * Returns false when the deferred pool is full or already holds the validator.
   */
  deferVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit,
    validity: VoluntaryExitValidity,
    currentEpoch: Epoch
  ): boolean;

  validateGossipBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<void>;
  validateApiBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<void>;
  importBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    opts: {preCapella?: boolean}
  ): void;

  validateGossipPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage
  ): Promise<PayloadAttestationValidationResult>;
  validateApiPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage
  ): Promise<PayloadAttestationValidationResult>;
  /**
   * The pool only serves a proposer attached to this node, so `addToPool` is set by the caller.
   * A pool error must not skip the PTC vote. Returns null when the message was not pooled.
   */
  importPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage,
    result: PayloadAttestationValidationResult,
    opts: {addToPool: boolean; addToForkChoice: boolean}
  ): InsertOutcome | null;

  validateGossipExecutionPayloadBid(bid: gloas.SignedExecutionPayloadBid): Promise<ExecutionPayloadBidValidationResult>;
  validateApiExecutionPayloadBid(bid: gloas.SignedExecutionPayloadBid): Promise<ExecutionPayloadBidValidationResult>;
  importExecutionPayloadBid(bid: gloas.SignedExecutionPayloadBid, opts: {receivedMs: number}): InsertOutcome;

  /**
   * Accepted preferences are pooled during validation, there is no import step: the pool doubles as the seen
   * cache, and the known check must happen in the same tick as the insert once the signature await resolves.
   */
  validateGossipProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): Promise<void>;
  validateApiProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): Promise<void>;

  validateGossipInclusionList(signedInclusionList: heze.SignedInclusionList): Promise<InclusionListValidationResult>;
  validateApiInclusionList(signedInclusionList: heze.SignedInclusionList): Promise<InclusionListValidationResult>;
  importInclusionList(
    signedInclusionList: heze.SignedInclusionList,
    result: InclusionListValidationResult,
    opts: {isTimely: boolean}
  ): InclusionListInsertOutcome;

  /**
   * Blocks and envelopes have no import step here: an accepted one goes through block import on the chain, which
   * also writes `seenBlockProposers` and `seenPayloadEnvelopeInputCache`. Those caches stay on the chain until
   * import notifies the engine.
   */
  validateGossipBlock(fork: ForkName, signedBlock: SignedBeaconBlock): Promise<GossipBlockValidationResult>;
  validateApiBlock(fork: ForkName, signedBlock: SignedBeaconBlock): Promise<GossipBlockValidationResult>;
  /** Proposer signature and equivocation tracking only, for a block retained for unknown parent sync */
  validateGossipBlockWithUnknownParent(signedBlock: SignedBeaconBlock, blockRootHex: RootHex): Promise<void>;
  verifyBlockProposerSignature(
    signedBlock: SignedBeaconBlock,
    blockRootHex: RootHex,
    opts?: {verifyOnMainThread?: boolean}
  ): Promise<void>;

  validateGossipExecutionPayloadEnvelope(signedEnvelope: gloas.SignedExecutionPayloadEnvelope): Promise<void>;
  validateApiExecutionPayloadEnvelope(signedEnvelope: gloas.SignedExecutionPayloadEnvelope): Promise<void>;

  /**
   * Sidecars are validated here and assembled into a `BlockInput` / `PayloadEnvelopeInput` by the caller.
   * A native implementation needs KZG proof verification.
   */
  validateGossipBlobSidecar(fork: ForkName, blobSidecar: deneb.BlobSidecar, subnet: SubnetID): Promise<void>;
  validateGossipFuluDataColumnSidecar(dataColumnSidecar: fulu.DataColumnSidecar, subnet: SubnetID): Promise<void>;
  validateGossipGloasDataColumnSidecar(
    payloadInput: PayloadEnvelopeInput,
    dataColumnSidecar: gloas.DataColumnSidecar,
    subnet: SubnetID
  ): Promise<void>;

  // Reads of the pools and seen caches, served by whichever engine owns them. Grouped by the topic that writes them.

  getAggregatedAttestation(slot: Slot, attDataRootHex: RootHex, committeeIndex: CommitteeIndex): Attestation | null;
  getPooledAttestations(slot?: Slot): Attestation[];

  getAttestationsForBlock(fork: ForkName, state: IBeaconStateView): Attestation[];
  getPooledAggregates(slot?: Slot): Attestation[];

  getSyncCommitteeContribution(
    subcommitteeIndex: SubcommitteeIndex,
    slot: Slot,
    beaconBlockRoot: Root
  ): altair.SyncCommitteeContribution | null;

  getSyncAggregate(slot: Slot, beaconBlockRoot: Root): altair.SyncAggregate;

  getSlashingsAndExits(
    state: IBeaconStateView,
    blockType: BlockType
  ): [
    AttesterSlashing[],
    phase0.ProposerSlashing[],
    phase0.SignedVoluntaryExit[],
    capella.SignedBLSToExecutionChange[],
  ];
  getPooledAttesterSlashings(): AttesterSlashing[];
  getPooledProposerSlashings(): phase0.ProposerSlashing[];
  getPooledVoluntaryExits(): phase0.SignedVoluntaryExit[];
  getPooledBlsToExecutionChanges(): capella.SignedBLSToExecutionChange[];
  hasSeenProposerSlashing(validatorIndex: ValidatorIndex): boolean;
  /** Removes and returns the deferred exits that `state` can now process, drops the ones deferred for too long */
  drainProcessableVoluntaryExits(state: IBeaconStateView): phase0.SignedVoluntaryExit[];

  getPayloadAttestationsForBlock(beaconBlockRootHex: RootHex, slot: Slot): gloas.PayloadAttestation[];
  getPooledPayloadAttestations(slot?: Slot): gloas.PayloadAttestation[];

  getBestExecutionPayloadBid(
    slot: Slot,
    parentBlockHash: RootHex | null,
    parentBlockRoot: RootHex
  ): PooledExecutionPayloadBid | null;

  getProposerPreferences(slot: Slot, dependentRootHex: RootHex): gloas.SignedProposerPreferences | null;
  getAllProposerPreferences(slot?: Slot, dependentRootHex?: RootHex): gloas.SignedProposerPreferences[];

  getInclusionListTransactions(slot: Slot, dependentRootHex: RootHex, onlyTimely?: boolean): bellatrix.Transactions;
  getInclusionListBits(slot: Slot, dependentRootHex: RootHex, onlyTimely?: boolean): BitArray;
  isInclusionListBitsInclusive(slot: Slot, dependentRootHex: RootHex, bits: BitArray): boolean;
  getInclusionListsByIndices(slot: Slot, dependentRootHex: RootHex, indices: BitArray): heze.SignedInclusionList[];

  isBlockProposerKnown(slot: Slot, proposerIndex: ValidatorIndex): boolean;
  hasSeenBlockRoot(slot: Slot, proposerIndex: ValidatorIndex, blockRootHex: RootHex): boolean;
  isProposerEquivocating(slot: Slot, proposerIndex: ValidatorIndex): boolean;
  getConflictingBlockRoots(slot: Slot, proposerIndex: ValidatorIndex, blockRootHex: RootHex): RootHex[];
  getProposerEquivocationHeaders(
    slot: Slot,
    proposerIndex: ValidatorIndex
  ): [phase0.SignedBeaconBlockHeader, phase0.SignedBeaconBlockHeader] | null;

  /** Liveness across every seen cache: a validator is live if any engine saw it attest, aggregate or propose */
  validatorSeenAtEpoch(validatorIndex: ValidatorIndex, epoch: Epoch): boolean;
}
