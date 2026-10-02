import {describe, expect, it} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {initializeForkChoiceFromFinalizedState} from "../../../../src/chain/forkChoice/index.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {generateState} from "../../../utils/state.js";

describe("checkpoint-sync fork choice", () => {
  const config = getConfig(ForkName.phase0);

  function createState(slot: number, justifiedCheckpoint = ssz.phase0.Checkpoint.defaultValue()): BeaconStateView {
    const state = generateState(
      {
        slot,
        latestBlockHeader: {...ssz.phase0.BeaconBlockHeader.defaultValue(), slot},
        currentJustifiedCheckpoint: justifiedCheckpoint,
      },
      config
    );
    state.genesisTime = 0;
    return new BeaconStateView(createCachedBeaconStateTest(state, config));
  }

  function initialize(anchorEpoch = 2) {
    const anchorState = createState(anchorEpoch * SLOTS_PER_EPOCH);
    const checkpoint = anchorState.computeAnchorCheckpoint().checkpoint;
    const forkChoice = initializeForkChoiceFromFinalizedState(
      config,
      new ChainEventEmitter(),
      anchorState.slot,
      anchorState,
      {computeUnrealized: true},
      (_checkpoint, state) => state.getEffectiveBalanceIncrementsZeroInactive(),
      () => null,
      null
    );
    return {forkChoice, checkpoint};
  }

  function createChild(slot: number, checkpoint: phase0.Checkpoint, votingSource: phase0.Checkpoint) {
    const state = createState(slot, votingSource);
    state.cachedState.blockRoots.set(checkpoint.epoch * SLOTS_PER_EPOCH, checkpoint.root);
    const block = {
      ...ssz.phase0.BeaconBlock.defaultValue(),
      slot,
      parentRoot: checkpoint.root,
      stateRoot: state.hashTreeRoot(),
    };
    return {block, state};
  }

  it.each([0, 2])("initializes justified and finalized to the epoch %i anchor", (anchorEpoch) => {
    const {forkChoice, checkpoint} = initialize(anchorEpoch);
    const expected = {...checkpoint, rootHex: toRootHex(checkpoint.root)};
    expect(forkChoice.getJustifiedCheckpoint()).toEqual(expected);
    expect(forkChoice.getFinalizedCheckpoint()).toEqual(expected);
    expect(forkChoice.getUnrealizedJustifiedCheckpoint()).toEqual(expected);
  });

  it("keeps descendants justified at the anchor eligible after a sync gap", () => {
    const {forkChoice, checkpoint} = initialize();
    const currentSlot = 5 * SLOTS_PER_EPOCH;
    const {block, state} = createChild(currentSlot, checkpoint, checkpoint);
    forkChoice.updateTime(currentSlot);
    forkChoice.onBlock(block, state, 0, 0, currentSlot, ExecutionStatus.PreMerge, DataAvailabilityStatus.PreData);

    expect(forkChoice.updateHead().blockRoot).toBe(toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block)));
    expect(forkChoice.getFinalizedCheckpoint().rootHex).toBe(toRootHex(checkpoint.root));
  });

  it.each([1, SLOTS_PER_EPOCH])("does not copy trusted anchor checkpoints into a child %i slots later", (offset) => {
    const {forkChoice, checkpoint} = initialize();
    const currentSlot = 4 * SLOTS_PER_EPOCH;
    const votingSource = {epoch: 1, root: new Uint8Array(32).fill(1)};
    const {block, state} = createChild(2 * SLOTS_PER_EPOCH + offset, checkpoint, votingSource);
    const expected = state.computeUnrealizedCheckpoints();
    forkChoice.updateTime(currentSlot);
    const imported = forkChoice.onBlock(
      block,
      state,
      0,
      0,
      currentSlot,
      ExecutionStatus.PreMerge,
      DataAvailabilityStatus.PreData
    );

    expect(imported.unrealizedJustifiedEpoch).toBe(expected.justifiedCheckpoint.epoch);
    expect(imported.unrealizedJustifiedRoot).toBe(toRootHex(expected.justifiedCheckpoint.root));
    expect(imported.unrealizedFinalizedEpoch).toBe(expected.finalizedCheckpoint.epoch);
    expect(forkChoice.updateHead().blockRoot).toBe(toRootHex(checkpoint.root));
  });
});
