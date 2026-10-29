import {routes} from "@lodestar/api";
import {ForkChoiceStateGetter, ProtoBlock} from "@lodestar/fork-choice";
import {EpochShuffling, IBeaconStateView} from "@lodestar/state-transition";
import {Epoch, RootHex, phase0} from "@lodestar/types";
import {IStateRegenerator, RegenCaller} from "../regen/interface.js";
import {BeaconCommitteeGetter} from "../shufflingCache.js";

/**
 * Owns every beacon state the node holds: regen, the block and checkpoint state caches and the shuffling
 * cache. Callers never touch those caches directly, so the whole group can be swapped for a native
 * (lodestar-z) implementation that keeps states in Zig memory.
 */
export interface IStateEngine extends IStateRegenerator, BeaconCommitteeGetter {
  /** Load persisted checkpoint states. Call once before use. */
  init(): Promise<void>;
  /** Release every state the engine holds. Nothing may be called after this. */
  close(): void;
  canAcceptWork(): boolean;
  dumpRegenQueue(): routes.lodestar.RegenQueueItem[];

  getShuffling(epoch: Epoch, decisionRoot: RootHex): Promise<EpochShuffling | null>;
  getShufflingSync(epoch: Epoch, decisionRoot: RootHex): EpochShuffling | null;
  hasShuffling(epoch: Epoch, decisionRoot: RootHex): boolean;
  processShufflings(state: IBeaconStateView): void;
  /**
   * Regenerate state for attestation verification, this does not happen with default chain option of maxSkipSlots = 32.
   * Lodestar doesn't support multiple regen state requests for attestation verification at the same time,
   * bounded inside the shuffling cache.
   */
  regenStateForAttestationVerification(
    attEpoch: Epoch,
    shufflingDependentRoot: RootHex,
    attHeadBlock: ProtoBlock,
    regenCaller: RegenCaller
  ): Promise<EpochShuffling>;

  /** Serialized checkpoint state from the datastore, or the latest safe one if `checkpoint` is omitted */
  getPersistedCheckpointState(checkpoint?: phase0.Checkpoint): Promise<Uint8Array | null>;
}

/**
 * Fork choice needs engine-owned states while it is constructed, and regen needs fork choice.
 * The engine therefore builds fork choice itself, through a factory supplied by the caller.
 */
export type ForkChoiceStateInputs = {
  stateGetter: ForkChoiceStateGetter;
};
