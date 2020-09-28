import {
  Attestation,
  BlockEventPayload,
  ChainHead,
  ChainReorg,
  FinalizedCheckpoint,
  SignedVoluntaryExit,
} from "@chainsafe/lodestar-types";

export enum BeaconEventType {
  HEAD = "head",
  BLOCK = "block",
  ATTESTATION = "attestation",
  VOLUNTARY_EXIT = "voluntary_exit",
  FINALIZED_CHECKPOINT = "finalized_checkpoint",
  CHAIN_REORG = "chain_reorg",
}

export type BeaconHeadEvent = {
  type: typeof BeaconEventType.HEAD;
  message: ChainHead;
};

export type BeaconBlockEvent = {
  type: typeof BeaconEventType.BLOCK;
  message: BlockEventPayload;
};

export type BeaconAttestationEvent = {
  type: typeof BeaconEventType.ATTESTATION;
  message: Attestation;
};

export type VoluntaryExitEvent = {
  type: typeof BeaconEventType.VOLUNTARY_EXIT;
  message: SignedVoluntaryExit;
};

export type FinalizedCheckpointEvent = {
  type: typeof BeaconEventType.FINALIZED_CHECKPOINT;
  message: FinalizedCheckpoint;
};

export type BeaconChainReorgEvent = {
  type: typeof BeaconEventType.CHAIN_REORG;
  message: ChainReorg;
};

export type BeaconEvent =
  | BeaconHeadEvent
  | BeaconBlockEvent
  | BeaconAttestationEvent
  | VoluntaryExitEvent
  | FinalizedCheckpointEvent
  | BeaconChainReorgEvent;
