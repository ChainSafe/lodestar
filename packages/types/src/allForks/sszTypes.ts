import {ssz as phase0} from "../phase0/index.js";
import {ssz as altair} from "../altair/index.js";
import {ssz as bellatrix} from "../bellatrix/index.js";
import {ssz as capella} from "../capella/index.js";

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
    // Not used in phase0 but added for type consitency
    ExecutionPayload: bellatrix.ExecutionPayload,
    ExecutionPayloadHeader: bellatrix.ExecutionPayloadHeader,
  },
  altair: {
    BeaconBlockBody: altair.BeaconBlockBody,
    BeaconBlock: altair.BeaconBlock,
    SignedBeaconBlock: altair.SignedBeaconBlock,
    BeaconState: altair.BeaconState,
    Metadata: altair.Metadata,
    // Not used in altair but added for type consitency
    ExecutionPayload: bellatrix.ExecutionPayload,
    ExecutionPayloadHeader: bellatrix.ExecutionPayloadHeader,
  },
  bellatrix: {
    BeaconBlockBody: bellatrix.BeaconBlockBody,
    BeaconBlock: bellatrix.BeaconBlock,
    SignedBeaconBlock: bellatrix.SignedBeaconBlock,
    BeaconState: bellatrix.BeaconState,
    Metadata: altair.Metadata,
    ExecutionPayload: bellatrix.ExecutionPayload,
    ExecutionPayloadHeader: bellatrix.ExecutionPayloadHeader,
  },
  capella: {
    BeaconBlockBody: capella.BeaconBlockBody,
    BeaconBlock: capella.BeaconBlock,
    SignedBeaconBlock: capella.SignedBeaconBlock,
    BeaconState: capella.BeaconState,
    Metadata: altair.Metadata,
    // Not used in phase0 but added for type consitency
    ExecutionPayload: capella.ExecutionPayload,
    ExecutionPayloadHeader: capella.ExecutionPayloadHeader,
  },
};

/**
 * Index the ssz types that differ by fork
 * A record of AllForksSSZTypes indexed by fork
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
};
