import {BeaconConfig} from "@lodestar/config";
import {IForkChoice} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView, PubkeyCache} from "@lodestar/state-transition";
import {
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SubnetID,
  ValidatorIndex,
  altair,
  deneb,
  fulu,
  gloas,
} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/index.js";
import {BufferPool} from "../../util/bufferPool.js";
import {IClock} from "../../util/clock.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {ChainEventEmitter} from "../emitter.js";
import {SeenBlockInput} from "../seenCache/seenGossipBlockInput.js";
import {CPStateDatastore} from "../stateCache/datastore/types.js";
import {AggregateAndProofValidationResult} from "../validation/aggregateAndProof.js";
import {ApiAttestation, AttestationValidationResult, GossipAttestation} from "../validation/attestation.js";
import {GossipBlockValidationResult} from "../validation/block.js";
import {PayloadAttestationValidationResult} from "../validation/payloadAttestationMessage.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {GossipValidationResult} from "./gossipValidationResult.js";
import {IBeaconEngineOptions} from "./options.js";

export type BeaconEngineModules = {
  opts: IBeaconEngineOptions;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  clock: IClock;
  pubkeyCache: PubkeyCache;
  bufferPool: BufferPool;
  cpStateDatastore: CPStateDatastore;
  // TODO - beacon engine: emitter is facade infra; forkChoice/regen should not depend on it inside the engine.
  emitter: ChainEventEmitter;
  signal: AbortSignal;
  db: IBeaconDb;
  validatorMonitor: ValidatorMonitor | null;
  seenBlockInputCache: SeenBlockInput;
  isAnchorStateFinalized: boolean;
};

/**
 * The consensus engine seam. Starts minimal and transitional (JS-only); ownership of consensus
 * collaborators and flows migrates here across later phases. This interface is the contract shared
 * with the native engine (lodestar-z) — both the JS and native engines implement the same signatures.
 */
export interface IBeaconEngine {
  readonly config: BeaconConfig;
  // Full fork choice (read + write). The engine owns it; writes are routed here while the flows that
  // perform them still live facade-side. TODO - beacon engine: narrow to a read facet as those flows
  // (gossip → Phase 3, migrateFinalized/prune → Phase 5) move into the engine.
  readonly forkChoice: IForkChoice;

  // Gossip validation flows. The first parameter is the message's SSZ bytes (unused by the JS engine,
  // required by the native engine's bytes-first contract), followed by the deserialized object. Each
  // returns a `GossipValidationResult` (no throw) so the native engine can return outcomes across FFI.
  validateGossipBlock(
    blockBytes: Uint8Array,
    signedBlock: SignedBeaconBlock,
    fork: ForkName
  ): Promise<GossipValidationResult<GossipBlockValidationResult>>;
  validateGossipSyncCommittee(
    syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<GossipValidationResult<{indicesInSubcommittee: number[]}>>;
  validateApiSyncCommittee(
    headState: IBeaconStateView,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<void>>;
  validateSyncCommitteeGossipContributionAndProof(
    contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof,
    skipValidationKnownParticipants?: boolean
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>>;
  validateGossipBlobSidecar(
    blobBytes: Uint8Array,
    fork: ForkName,
    blobSidecar: deneb.BlobSidecar,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipFuluDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    dataColumnSidecar: fulu.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipGloasDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    payloadInput: PayloadEnvelopeInput,
    dataColumnSidecar: gloas.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>>;
  validateGossipPayloadAttestationMessage(
    payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<PayloadAttestationValidationResult>>;
  validateApiPayloadAttestationMessage(
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<PayloadAttestationValidationResult>>;
  validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}>;
  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>>;
  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<AggregateAndProofValidationResult>>;
  validateApiAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<AggregateAndProofValidationResult>>;
  validateGossipExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
  ): Promise<GossipValidationResult<void>>;
  validateApiExecutionPayloadEnvelope(
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
  ): Promise<GossipValidationResult<void>>;
  validateGossipExecutionPayloadBid(
    bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>>;
  validateApiExecutionPayloadBid(
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>>;
  validateGossipProposerPreferences(
    preferencesBytes: Uint8Array,
    signedProposerPreferences: gloas.SignedProposerPreferences
  ): Promise<GossipValidationResult<void>>;
}
