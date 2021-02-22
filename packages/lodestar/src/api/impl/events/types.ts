import {phase0} from "@chainsafe/lodestar-types";

export enum BeaconEventType {
  HEAD = "head",
  BLOCK = "block",
  ATTESTATION = "attestation",
  VOLUNTARY_EXIT = "voluntary_exit",
  CHAIN_REORG = "chain_reorg",
  FINALIZED_CHECKPOINT = "finalized_checkpoint",
}

export type BeaconHeadEvent = {
  type: typeof BeaconEventType.HEAD;
  message: phase0.ChainHead;
};

export type BeaconBlockEvent = {
  type: typeof BeaconEventType.BLOCK;
  message: phase0.BlockEventPayload;
};

export type BeaconAttestationEvent = {
  type: typeof BeaconEventType.ATTESTATION;
  message: phase0.Attestation;
};

export type VoluntaryExitEvent = {
  type: typeof BeaconEventType.VOLUNTARY_EXIT;
  message: phase0.SignedVoluntaryExit;
};

export type FinalizedCheckpointEvent = {
  type: typeof BeaconEventType.FINALIZED_CHECKPOINT;
  message: phase0.FinalizedCheckpoint;
};

export type BeaconChainReorgEvent = {
  type: typeof BeaconEventType.CHAIN_REORG;
  message: phase0.ChainReorg;
};

export type BeaconEvent =
  | BeaconHeadEvent
  | BeaconBlockEvent
  | BeaconAttestationEvent
  | VoluntaryExitEvent
  | BeaconChainReorgEvent
  | FinalizedCheckpointEvent;
