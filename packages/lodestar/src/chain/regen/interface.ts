import {BeaconBlock, Checkpoint, Root, Slot} from "@chainsafe/lodestar-types";
import {ITreeStateContext} from "../stateContextCache";

/**
 * Regenerates states that have already been processed by the fork choice
 */
export interface IStateRegenerator {
  /**
   * Return a valid pre-state for a beacon block
   * This will always return a state in the latest viable epoch
   */
  getPreState: (block: BeaconBlock) => Promise<ITreeStateContext>;

  /**
   * Return a valid checkpoint state
   * This will always return a state with `state.slot % SLOTS_PER_EPOCH === 0`
   */
  getCheckpointState: (cp: Checkpoint) => Promise<ITreeStateContext>;

  /**
   * Return the state of `blockRoot` processed to slot `slot`
   */
  getBlockSlotState: (blockRoot: Root, slot: Slot) => Promise<ITreeStateContext>;

  /**
   * Return the exact state with `stateRoot`
   */
  getState: (stateRoot: Root) => Promise<ITreeStateContext>;
}
