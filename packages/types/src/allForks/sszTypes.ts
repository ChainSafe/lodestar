import {ssz as phase0} from "../phase0/index.js";
import {ssz as altair} from "../altair/index.js";
import {ssz as bellatrix} from "../bellatrix/index.js";
import {ssz as capella} from "../capella/index.js";
import {ssz as deneb} from "../deneb/index.js";

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
  },
  altair: {
    BeaconBlockBody: altair.BeaconBlockBody,
    BeaconBlock: altair.BeaconBlock,
    SignedBeaconBlock: altair.SignedBeaconBlock,
    BeaconState: altair.BeaconState,
    Metadata: altair.Metadata,
  },
  bellatrix: {
    BeaconBlockBody: bellatrix.BeaconBlockBody,
    BeaconBlock: bellatrix.BeaconBlock,
    SignedBeaconBlock: bellatrix.SignedBeaconBlock,
    BeaconState: bellatrix.BeaconState,
    Metadata: altair.Metadata,
  },
  capella: {
    BeaconBlockBody: capella.BeaconBlockBody,
    BeaconBlock: capella.BeaconBlock,
    SignedBeaconBlock: capella.SignedBeaconBlock,
    BeaconState: capella.BeaconState,
    Metadata: altair.Metadata,
  },
  deneb: {
    BeaconBlockBody: deneb.BeaconBlockBody,
    BeaconBlock: deneb.BeaconBlock,
    SignedBeaconBlock: deneb.SignedBeaconBlock,
    BeaconState: deneb.BeaconState,
    Metadata: altair.Metadata,
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
};

export const allForksBlobs = {
  deneb: {
    SignedBeaconBlockAndBlobsSidecar: deneb.SignedBeaconBlockAndBlobsSidecar,
  },
};
