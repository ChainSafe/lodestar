import {ForkName} from "@lodestar/params";
import {IBeaconStateView, VoluntaryExitValidity} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  Domain,
  Epoch,
  IndexedAttestation,
  RootHex,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
  SubnetID,
  altair,
  capella,
  deneb,
  fulu,
  gloas,
  heze,
  phase0,
} from "@lodestar/types";
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
  attesterSlashing = "attesterSlashing",
  proposerSlashing = "proposerSlashing",
  voluntaryExit = "voluntaryExit",
  blsToExecutionChange = "blsToExecutionChange",
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
}
