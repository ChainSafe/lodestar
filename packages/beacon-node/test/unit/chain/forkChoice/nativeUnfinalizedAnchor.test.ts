import {describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {EpochDifference} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {
  BeaconStateView,
  computeAnchorCheckpoint,
  getEffectiveBalanceIncrementsZeroed,
} from "@lodestar/state-transition";
import {Slot, phase0, ssz} from "@lodestar/types";
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
  const epochCheckpointRoot = new Uint8Array(32).fill(0x0c);

  function initialize(isFinalizedState: boolean) {
    const latestBlockHeader = ssz.phase0.BeaconBlockHeader.defaultValue();
    latestBlockHeader.slot = anchorSlot;
    latestBlockHeader.parentRoot = parentRoot;
    const blockRoots = ssz.phase0.BeaconState.defaultValue().blockRoots;
    blockRoots[3 * SLOTS_PER_EPOCH] = epochCheckpointRoot;
    const cachedState = createCachedBeaconStateTest(
      generateState(
        {
          slot: anchorSlot,
          latestBlockHeader,
          blockRoots,
          finalizedCheckpoint,
          currentJustifiedCheckpoint: justifiedCheckpoint,
        },
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
      toRootHex(epochCheckpointRoot),
      toRootHex(parentRoot),
      anchorRoot,
    ]);
    expect(forkChoice.getAncestor(anchorRoot, 3 * SLOTS_PER_EPOCH).blockRoot).toBe(toRootHex(epochCheckpointRoot));
    expect(forkChoice.getBlockHexDefaultStatus(toRootHex(parentRoot))?.targetRoot).toBe(toRootHex(epochCheckpointRoot));
    expect(forkChoice.getBlockHexDefaultStatus(toRootHex(epochCheckpointRoot))?.targetRoot).toBe(
      toRootHex(epochCheckpointRoot)
    );
    expect(forkChoice.getAncestor(anchorRoot, SLOTS_PER_EPOCH).blockRoot).toBe(toRootHex(finalizedCheckpoint.root));
    for (const checkpoint of [finalizedCheckpoint, justifiedCheckpoint]) {
      expect(
        forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus(toRootHex(checkpoint.root)).nonAncestors,
        `non-ancestors of the epoch ${checkpoint.epoch} checkpoint`
      ).toEqual([]);
    }
    expect(forkChoice.prune(toRootHex(finalizedCheckpoint.root))).toEqual([]);
  });

  it("makes a finalized anchor both checkpoints", () => {
    const {forkChoice, anchorRoot} = initialize(true);

    expect(forkChoice.getFinalizedCheckpoint().rootHex).toBe(anchorRoot);
    expect(forkChoice.getJustifiedCheckpoint().rootHex).toBe(anchorRoot);
    expect(forkChoice.forwarditerateAncestorBlocks().map((block) => block.blockRoot)).toEqual([anchorRoot]);
  });
});

describe("native fork choice anchor ancestors", () => {
  const root = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);
  const finalized = {epoch: 1, root: root(0x0f)};
  const justified = {epoch: 2, root: root(0x0a)};
  const never = {epoch: 0, root: new Uint8Array(32)};
  const genesisRoot = root(0x99);
  const parent = root(0x0b);
  const checkpoint = root(0x0c);

  type AnchorShape = {
    name: string;
    stateSlot: Slot;
    blockSlot: Slot;
    parentRoot: Uint8Array;
    finalizedCheckpoint: phase0.Checkpoint;
    justifiedCheckpoint: phase0.Checkpoint;
    /** Block roots of the state by slot, the ancestors the fork choice can know */
    blockRoots: Record<Slot, Uint8Array>;
    /** Ancestor slots expected in the fork choice, oldest first */
    ancestorSlots: Slot[];
  };

  function initialize(shape: AnchorShape) {
    const latestBlockHeader = ssz.phase0.BeaconBlockHeader.defaultValue();
    latestBlockHeader.slot = shape.blockSlot;
    latestBlockHeader.parentRoot = shape.parentRoot;
    const blockRoots = ssz.phase0.BeaconState.defaultValue().blockRoots;
    for (const [slot, blockRoot] of Object.entries(shape.blockRoots)) {
      blockRoots[Number(slot) % SLOTS_PER_HISTORICAL_ROOT] = blockRoot;
    }
    const cachedState = createCachedBeaconStateTest(
      generateState(
        {
          slot: shape.stateSlot,
          latestBlockHeader,
          blockRoots,
          finalizedCheckpoint: shape.finalizedCheckpoint,
          currentJustifiedCheckpoint: shape.justifiedCheckpoint,
        },
        config
      ),
      config
    );
    return initializeForkChoice(
      config,
      new ChainEventEmitter(),
      shape.stateSlot,
      new BeaconStateView(cachedState),
      false,
      {nativeForkChoice: true},
      () => getEffectiveBalanceIncrementsZeroed(0),
      () => null,
      null
    );
  }

  const shapes: AnchorShape[] = [
    {
      name: "mid epoch",
      stateSlot: 98,
      blockSlot: 98,
      parentRoot: parent,
      finalizedCheckpoint: finalized,
      justifiedCheckpoint: justified,
      blockRoots: {32: finalized.root, 63: root(0x3f), 64: justified.root, 95: root(0x5f), 96: checkpoint, 97: parent},
      ancestorSlots: [32, 63, 64, 95, 96, 97],
    },
    {
      name: "first slot of an epoch",
      stateSlot: 96,
      blockSlot: 96,
      parentRoot: parent,
      finalizedCheckpoint: finalized,
      justifiedCheckpoint: justified,
      blockRoots: {32: finalized.root, 63: root(0x3f), 64: justified.root, 95: parent},
      ancestorSlots: [32, 63, 64, 95],
    },
    {
      name: "parent is the epoch checkpoint block",
      stateSlot: 97,
      blockSlot: 97,
      parentRoot: checkpoint,
      finalizedCheckpoint: finalized,
      justifiedCheckpoint: justified,
      blockRoots: {32: finalized.root, 63: root(0x3f), 64: justified.root, 95: root(0x5f), 96: checkpoint},
      ancestorSlots: [32, 63, 64, 95, 96],
    },
    {
      name: "no block since the justified one until the anchor's epoch",
      stateSlot: 130,
      blockSlot: 130,
      parentRoot: parent,
      finalizedCheckpoint: finalized,
      justifiedCheckpoint: justified,
      blockRoots: {
        32: finalized.root,
        64: justified.root,
        95: justified.root,
        96: justified.root,
        127: root(0x7f),
        128: checkpoint,
        129: parent,
      },
      ancestorSlots: [32, 64, 127, 128, 129],
    },
    {
      name: "state dialed past its block to the epoch start",
      stateSlot: 96,
      blockSlot: 94,
      parentRoot: parent,
      finalizedCheckpoint: finalized,
      justifiedCheckpoint: justified,
      blockRoots: {32: finalized.root, 63: root(0x3f), 64: justified.root, 93: parent},
      ancestorSlots: [32, 63, 64, 93],
    },
    {
      name: "never justified",
      stateSlot: 40,
      blockSlot: 40,
      parentRoot: parent,
      finalizedCheckpoint: never,
      justifiedCheckpoint: never,
      blockRoots: {0: genesisRoot, 31: root(0x1f), 32: checkpoint, 39: parent},
      ancestorSlots: [0, 31, 32, 39],
    },
    {
      name: "justified long before the anchor",
      stateSlot: 322,
      blockSlot: 322,
      parentRoot: parent,
      finalizedCheckpoint: finalized,
      justifiedCheckpoint: justified,
      blockRoots: {
        32: finalized.root,
        64: justified.root,
        287: root(0x1e),
        288: root(0x90),
        319: root(0x3e),
        320: checkpoint,
        321: parent,
      },
      ancestorSlots: [32, 64, 287, 288, 319, 320, 321],
    },
  ];

  it.each(shapes)("$name", (shape) => {
    const forkChoice = initialize(shape);
    const head = forkChoice.getHead();
    const ancestors = forkChoice.forwarditerateAncestorBlocks().slice(0, -1);

    expect(head.slot).toBe(shape.blockSlot);
    expect(ancestors.map((block) => block.slot)).toEqual(shape.ancestorSlots);
    expect(ancestors.map((block) => block.blockRoot)).toEqual(
      shape.ancestorSlots.map((slot) => toRootHex(shape.blockRoots[slot]))
    );

    const epochStartSlot = head.slot - (head.slot % SLOTS_PER_EPOCH);
    for (const epochDifference of [EpochDifference.current, EpochDifference.previous]) {
      const dependentSlot = Math.max(epochStartSlot - epochDifference * SLOTS_PER_EPOCH - 1, 0);
      // Below the finalized block the fork choice holds no ancestor
      if (dependentSlot < shape.finalizedCheckpoint.epoch * SLOTS_PER_EPOCH) continue;
      expect(forkChoice.getDependentRoot(head, epochDifference), `wrong dependent root at slot ${dependentSlot}`).toBe(
        toRootHex(shape.blockRoots[dependentSlot])
      );
    }
  });

  it("names the cause when the genesis block root has left the state", () => {
    const stateSlot = SLOTS_PER_HISTORICAL_ROOT + 108;
    expect(() =>
      initialize({
        name: "never justified, genesis out of reach",
        stateSlot,
        blockSlot: stateSlot,
        parentRoot: parent,
        finalizedCheckpoint: never,
        justifiedCheckpoint: never,
        blockRoots: {[stateSlot - 1]: parent},
        ancestorSlots: [],
      })
    ).toThrow("never justified a checkpoint");
  });
});
