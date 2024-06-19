import {ssz as phase0} from "../phase0/index.js";
import {ssz as altair} from "../altair/index.js";
import {ssz as bellatrix} from "../bellatrix/index.js";
import {ssz as capella} from "../capella/index.js";
import {ssz as deneb} from "../deneb/index.js";
import {ssz as electra} from "../electra/index.js";

/**
 * Index the ssz types that differ by fork
 * A record of AllForksSSZTypes indexed by fork
 */
export const allForks = {
  phase0: {
    BeaconBlockBody: phase0.BeaconBlockBody,
    BeaconBlock: phase0.BeaconBlock,
    SignedBeaconBlock: phase0.SignedBeaconBlock,
    BeaconState: phase0.BeaconState,
    Metadata: phase0.Metadata,
    AggregateAndProof: phase0.AggregateAndProof,
    SignedAggregateAndProof: phase0.SignedAggregateAndProof,
    Attestation: phase0.Attestation,
    IndexedAttestation: phase0.IndexedAttestation,
    AttesterSlashing: phase0.AttesterSlashing,
  },
  altair: {
    BeaconBlockBody: altair.BeaconBlockBody,
    BeaconBlock: altair.BeaconBlock,
    SignedBeaconBlock: altair.SignedBeaconBlock,
    BeaconState: altair.BeaconState,
    Metadata: altair.Metadata,
    AggregateAndProof: phase0.AggregateAndProof,
    SignedAggregateAndProof: phase0.SignedAggregateAndProof,
    Attestation: phase0.Attestation,
    IndexedAttestation: phase0.IndexedAttestation,
    AttesterSlashing: phase0.AttesterSlashing,
  },
  bellatrix: {
    BeaconBlockBody: bellatrix.BeaconBlockBody,
    BeaconBlock: bellatrix.BeaconBlock,
    SignedBeaconBlock: bellatrix.SignedBeaconBlock,
    BeaconState: bellatrix.BeaconState,
    Metadata: altair.Metadata,
    AggregateAndProof: phase0.AggregateAndProof,
    SignedAggregateAndProof: phase0.SignedAggregateAndProof,
    Attestation: phase0.Attestation,
    IndexedAttestation: phase0.IndexedAttestation,
    AttesterSlashing: phase0.AttesterSlashing,
  },
  capella: {
    BeaconBlockBody: capella.BeaconBlockBody,
    BeaconBlock: capella.BeaconBlock,
    SignedBeaconBlock: capella.SignedBeaconBlock,
    BeaconState: capella.BeaconState,
    Metadata: altair.Metadata,
    AggregateAndProof: phase0.AggregateAndProof,
    SignedAggregateAndProof: phase0.SignedAggregateAndProof,
    Attestation: phase0.Attestation,
    IndexedAttestation: phase0.IndexedAttestation,
    AttesterSlashing: phase0.AttesterSlashing,
  },
  deneb: {
    BeaconBlockBody: deneb.BeaconBlockBody,
    BeaconBlock: deneb.BeaconBlock,
    SignedBeaconBlock: deneb.SignedBeaconBlock,
    BeaconState: deneb.BeaconState,
    Metadata: altair.Metadata,
    AggregateAndProof: phase0.AggregateAndProof,
    SignedAggregateAndProof: phase0.SignedAggregateAndProof,
    Attestation: phase0.Attestation,
    IndexedAttestation: phase0.IndexedAttestation,
    AttesterSlashing: phase0.AttesterSlashing,
  },
  electra: {
    BeaconBlockBody: electra.BeaconBlockBody,
    BeaconBlock: electra.BeaconBlock,
    SignedBeaconBlock: electra.SignedBeaconBlock,
    BeaconState: electra.BeaconState,
    Metadata: altair.Metadata,
    AggregateAndProof: electra.AggregateAndProof,
    SignedAggregateAndProof: electra.SignedAggregateAndProof,
    Attestation: electra.Attestation,
    IndexedAttestation: electra.IndexedAttestation,
    AttesterSlashing: electra.AttesterSlashing,
  },
};

/**
 * Index the execution ssz types that differ by fork
 * A record of AllForksExecutionSSZTypes indexed by fork
 */
export const allForksExecution = {
  bellatrix: {
    BeaconBlockBody: bellatrix.BeaconBlockBody,
    BeaconBlock: bellatrix.BeaconBlock,
    SignedBeaconBlock: bellatrix.SignedBeaconBlock,
    BeaconState: bellatrix.BeaconState,
    ExecutionPayload: bellatrix.ExecutionPayload,
    ExecutionPayloadHeader: bellatrix.ExecutionPayloadHeader,
    BuilderBid: bellatrix.BuilderBid,
    SignedBuilderBid: bellatrix.SignedBuilderBid,
    SSEPayloadAttributes: bellatrix.SSEPayloadAttributes,
  },
  capella: {
    BeaconBlockBody: capella.BeaconBlockBody,
    BeaconBlock: capella.BeaconBlock,
    SignedBeaconBlock: capella.SignedBeaconBlock,
    BeaconState: capella.BeaconState,
    // Not used in phase0 but added for type consitency
    ExecutionPayload: capella.ExecutionPayload,
    ExecutionPayloadHeader: capella.ExecutionPayloadHeader,
    BuilderBid: capella.BuilderBid,
    SignedBuilderBid: capella.SignedBuilderBid,
    SSEPayloadAttributes: capella.SSEPayloadAttributes,
  },
  deneb: {
    BeaconBlockBody: deneb.BeaconBlockBody,
    BeaconBlock: deneb.BeaconBlock,
    SignedBeaconBlock: deneb.SignedBeaconBlock,
    BeaconState: deneb.BeaconState,
    ExecutionPayload: deneb.ExecutionPayload,
    ExecutionPayloadHeader: deneb.ExecutionPayloadHeader,
    BuilderBid: deneb.BuilderBid,
    SignedBuilderBid: deneb.SignedBuilderBid,
    SSEPayloadAttributes: deneb.SSEPayloadAttributes,
  },
  electra: {
    BeaconBlockBody: electra.BeaconBlockBody,
    BeaconBlock: electra.BeaconBlock,
    SignedBeaconBlock: electra.SignedBeaconBlock,
    BeaconState: electra.BeaconState,
    ExecutionPayload: electra.ExecutionPayload,
    ExecutionPayloadHeader: electra.ExecutionPayloadHeader,
    BuilderBid: electra.BuilderBid,
    SignedBuilderBid: electra.SignedBuilderBid,
    SSEPayloadAttributes: electra.SSEPayloadAttributes,
  },
};

/**
 * Index the blinded ssz types that differ by fork
 * A record of AllForksBlindedSSZTypes indexed by fork
 */
export const allForksBlinded = {
  bellatrix: {
    BeaconBlockBody: bellatrix.BlindedBeaconBlockBody,
    BeaconBlock: bellatrix.BlindedBeaconBlock,
    SignedBeaconBlock: bellatrix.SignedBlindedBeaconBlock,
  },
  capella: {
    BeaconBlockBody: capella.BlindedBeaconBlockBody,
    BeaconBlock: capella.BlindedBeaconBlock,
    SignedBeaconBlock: capella.SignedBlindedBeaconBlock,
  },
  deneb: {
    BeaconBlockBody: deneb.BlindedBeaconBlockBody,
    BeaconBlock: deneb.BlindedBeaconBlock,
    SignedBeaconBlock: deneb.SignedBlindedBeaconBlock,
  },
  electra: {
    BeaconBlockBody: electra.BlindedBeaconBlockBody,
    BeaconBlock: electra.BlindedBeaconBlock,
    SignedBeaconBlock: electra.SignedBlindedBeaconBlock,
  },
};

export const allForksLightClient = {
  altair: {
    BeaconBlock: altair.BeaconBlock,
    BeaconBlockBody: altair.BeaconBlockBody,
    LightClientHeader: altair.LightClientHeader,
    LightClientBootstrap: altair.LightClientBootstrap,
    LightClientUpdate: altair.LightClientUpdate,
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: altair.LightClientOptimisticUpdate,
    LightClientStore: altair.LightClientStore,
  },
  bellatrix: {
    BeaconBlock: bellatrix.BeaconBlock,
    BeaconBlockBody: bellatrix.BeaconBlockBody,
    LightClientHeader: altair.LightClientHeader,
    LightClientBootstrap: altair.LightClientBootstrap,
    LightClientUpdate: altair.LightClientUpdate,
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: altair.LightClientOptimisticUpdate,
    LightClientStore: altair.LightClientStore,
  },
  capella: {
    BeaconBlock: capella.BeaconBlock,
    BeaconBlockBody: capella.BeaconBlockBody,
    LightClientHeader: capella.LightClientHeader,
    LightClientBootstrap: capella.LightClientBootstrap,
    LightClientUpdate: capella.LightClientUpdate,
    LightClientFinalityUpdate: capella.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: capella.LightClientOptimisticUpdate,
    LightClientStore: capella.LightClientStore,
  },
  deneb: {
    BeaconBlock: deneb.BeaconBlock,
    BeaconBlockBody: deneb.BeaconBlockBody,
    LightClientHeader: deneb.LightClientHeader,
    LightClientBootstrap: deneb.LightClientBootstrap,
    LightClientUpdate: deneb.LightClientUpdate,
    LightClientFinalityUpdate: deneb.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: deneb.LightClientOptimisticUpdate,
    LightClientStore: deneb.LightClientStore,
  },
  electra: {
    BeaconBlock: electra.BeaconBlock,
    BeaconBlockBody: electra.BeaconBlockBody,
    LightClientHeader: electra.LightClientHeader,
    LightClientBootstrap: electra.LightClientBootstrap,
    LightClientUpdate: electra.LightClientUpdate,
    LightClientFinalityUpdate: electra.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: electra.LightClientOptimisticUpdate,
    LightClientStore: electra.LightClientStore,
  },
};

export const allForksBlobs = {
  deneb: {
    BlobSidecar: deneb.BlobSidecar,
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle,
  },
  electra: {
    BlobSidecar: deneb.BlobSidecar,
    ExecutionPayloadAndBlobsBundle: electra.ExecutionPayloadAndBlobsBundle,
  },
};
