import {describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  BeaconStateView,
  computeAnchorCheckpoint,
  getEffectiveBalanceIncrementsZeroed,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ChainEventEmitter, initializeForkChoice} from "../../../../src/chain/index.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {generateState} from "../../../utils/state.js";

vi.unmock("@lodestar/fork-choice");

describe("native fork choice from an unfinalized state", () => {
  const anchorSlot = 3 * SLOTS_PER_EPOCH + 2;
  const finalizedCheckpoint = {epoch: 1, root: new Uint8Array(32).fill(0x0f)};
  const justifiedCheckpoint = {epoch: 2, root: new Uint8Array(32).fill(0x0a)};
  const parentRoot = new Uint8Array(32).fill(0x0b);

  function initialize(isFinalizedState: boolean) {
    const latestBlockHeader = ssz.phase0.BeaconBlockHeader.defaultValue();
    latestBlockHeader.slot = anchorSlot;
    latestBlockHeader.parentRoot = parentRoot;
    const cachedState = createCachedBeaconStateTest(
      generateState(
        {slot: anchorSlot, latestBlockHeader, finalizedCheckpoint, currentJustifiedCheckpoint: justifiedCheckpoint},
        config
      ),
      config
    );
    const anchorRoot = toRootHex(computeAnchorCheckpoint(config, cachedState).checkpoint.root);
    const forkChoice = initializeForkChoice(
      config,
      new ChainEventEmitter(),
      anchorSlot,
      new BeaconStateView(cachedState),
      isFinalizedState,
      {nativeForkChoice: true},
      () => getEffectiveBalanceIncrementsZeroed(0),
      () => null,
      null
    );
    return {forkChoice, anchorRoot};
  }

  it("starts at the state's checkpoints with the anchor as head", () => {
    const {forkChoice, anchorRoot} = initialize(false);

    expect(forkChoice.getFinalizedCheckpoint()).toMatchObject(finalizedCheckpoint);
    expect(forkChoice.getJustifiedCheckpoint()).toMatchObject(justifiedCheckpoint);
    expect(forkChoice.getHead().blockRoot).toBe(anchorRoot);
    expect(forkChoice.getFinalizedBlock().slot).toBe(SLOTS_PER_EPOCH);
    expect(forkChoice.getJustifiedBlock().slot).toBe(2 * SLOTS_PER_EPOCH);
    expect(forkChoice.forwarditerateAncestorBlocks().map((block) => block.blockRoot)).toEqual([
      toRootHex(finalizedCheckpoint.root),
      toRootHex(justifiedCheckpoint.root),
      toRootHex(parentRoot),
      anchorRoot,
    ]);
    expect(forkChoice.getAncestor(anchorRoot, SLOTS_PER_EPOCH).blockRoot).toBe(toRootHex(finalizedCheckpoint.root));
    expect(forkChoice.prune(toRootHex(finalizedCheckpoint.root))).toEqual([]);
  });

  it("makes a finalized anchor both checkpoints", () => {
    const {forkChoice, anchorRoot} = initialize(true);

    expect(forkChoice.getFinalizedCheckpoint().rootHex).toBe(anchorRoot);
    expect(forkChoice.getJustifiedCheckpoint().rootHex).toBe(anchorRoot);
    expect(forkChoice.forwarditerateAncestorBlocks().map((block) => block.blockRoot)).toEqual([anchorRoot]);
  });
});
