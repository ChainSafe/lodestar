import {ForkPostGloas} from "@lodestar/params";
import {Root, Slot, gloas, phase0} from "@lodestar/types";

export type AnchorSummary = {
  slot: Slot;
  stateRoot: Root;
  fork: phase0.Fork;
  checkpoint: phase0.Checkpoint;
  latestBlockSlot: Slot;
};

export type EngineBootstrap = AnchorSummary & {
  genesisTime: number;
  genesisValidatorsRoot: Root;
  previousJustifiedCheckpoint: phase0.Checkpoint;
  currentJustifiedCheckpoint: phase0.Checkpoint;
  finalizedCheckpoint: phase0.Checkpoint;
  gloasAnchor: {fork: ForkPostGloas; proposerIndex: number; bid: gloas.ExecutionPayloadBid} | null;
};
