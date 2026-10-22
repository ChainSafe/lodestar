import {describe, expect, it, vi} from "vitest";
import {CheckpointWithHex, ExecutionStatus, PayloadStatus, ProtoNode} from "@lodestar/fork-choice";
import {toRootHex} from "@lodestar/utils";
import {ChainViewPublisher} from "../../../../src/chain/beaconEngine/chainView.js";
import {BeaconEngineEvent, BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {ChainView} from "../../../../src/chain/chainView/chainView.js";
import {zeroProtoBlock} from "../../../utils/state.js";

function setup() {
  const root = Buffer.alloc(32, 1);
  const anchor = {...zeroProtoBlock, blockRoot: toRootHex(root)} as ProtoNode;
  const checkpoint: CheckpointWithHex = {epoch: 0, root, rootHex: anchor.blockRoot};
  const forkChoice = {
    getUnrealizedJustifiedCheckpoint: vi.fn(() => checkpoint),
    getUnrealizedFinalizedCheckpoint: vi.fn(() => checkpoint),
    getProposerBoostRoot: vi.fn(() => anchor.blockRoot),
    getPreviousProposerBoostRoot: vi.fn(() => anchor.blockRoot),
    getPTCVoteCounts: vi.fn(
      (): {attesterCount: number; payloadPresentCount: number; dataAvailableCount: number} | null => null
    ),
    getFastConfirmationStore: vi.fn(() => ({
      confirmedRoot: anchor.blockRoot,
      previousEpochObservedJustifiedCheckpoint: checkpoint,
      currentEpochObservedJustifiedCheckpoint: checkpoint,
      previousEpochGreatestUnrealizedCheckpoint: checkpoint,
      previousSlotHead: anchor.blockRoot,
      currentSlotHead: anchor.blockRoot,
    })),
    getAllNodes: vi.fn(() => [anchor]),
    getHead: vi.fn(() => anchor),
    getJustifiedCheckpoint: vi.fn(() => checkpoint),
    getFinalizedCheckpoint: vi.fn(() => checkpoint),
  };
  const publisher = new ChainViewPublisher(forkChoice);
  const events = new BeaconEngineEventBus();
  const views = [new ChainView(publisher.snapshot()), new ChainView(publisher.snapshot())];
  for (const view of views) events.on(BeaconEngineEvent.chainViewUpdated, (update) => view.applyUpdate(update));
  const publish = (blocksChanged = true) => {
    const update = publisher.update(blocksChanged);
    if (update) events.emit(BeaconEngineEvent.chainViewUpdated, update);
    return update;
  };
  return {anchor, forkChoice, publisher, views, publish};
}

describe("ChainViewPublisher", () => {
  it("replicates imports and reorgs without publishing execution-status changes", () => {
    const {anchor, forkChoice, views, publish} = setup();
    const child = {...anchor, blockRoot: toRootHex(Buffer.alloc(32, 2)), parentRoot: anchor.blockRoot, slot: 2};
    forkChoice.getAllNodes.mockReturnValue([anchor, child]);
    forkChoice.getHead.mockReturnValue(child);
    expect(publish()?.blocks.map((b) => b.blockRoot)).toEqual([child.blockRoot]);
    child.executionStatus = ExecutionStatus.Syncing;
    expect(publish()).toBeNull();
    for (const view of views) {
      expect(view.getHead(), "structural block metadata").not.toHaveProperty("executionStatus");
      expect(
        view.getAllAncestorBlocks(child.blockRoot, PayloadStatus.FULL).map((b) => b.slot),
        "replicated ancestry"
      ).toEqual([2, 0]);
    }
    forkChoice.getHead.mockReturnValue(anchor);
    const reorg = publish(false);
    expect(reorg?.blocks).toEqual([]);
    forkChoice.getAllNodes.mockReturnValue([anchor]);
    expect(publish()).toBeNull();
    for (const view of views) {
      expect(view.getHeadRoot(), "replicated reorg head").toBe(anchor.blockRoot);
      expect(view.hasBlockHexUnsafe(child.blockRoot), "engine pruning does not control retention").toBe(true);
    }
  });

  it("does not replicate execution-status changes on ancestors", () => {
    const {anchor, forkChoice, views, publish} = setup();
    const child = {...anchor, blockRoot: toRootHex(Buffer.alloc(32, 2)), parentRoot: anchor.blockRoot, slot: 2};
    forkChoice.getAllNodes.mockReturnValue([anchor, child]);
    forkChoice.getHead.mockReturnValue(child);
    publish();
    anchor.executionStatus = ExecutionStatus.Syncing;
    expect(publish()).toBeNull();
    anchor.executionStatus = ExecutionStatus.Valid;
    expect(publish()).toBeNull();
    for (const view of views) {
      expect(view.getBlockHexDefaultStatus(anchor.blockRoot), "ancestor metadata").not.toHaveProperty(
        "executionStatus"
      );
    }
  });

  it("publishes checkpoint changes without a head change and detaches checkpoint bytes", () => {
    const {forkChoice, publisher, views, publish} = setup();
    const finalized = {...forkChoice.getFinalizedCheckpoint(), epoch: 1};
    forkChoice.getFinalizedCheckpoint.mockReturnValue(finalized);
    const update = publish(false);
    expect(update?.blocks).toEqual([]);
    expect(publisher.update(false)).toBeNull();
    finalized.root.fill(9);
    for (const view of views) {
      expect(view.getFinalizedCheckpoint().epoch, "replicated finality").toBe(1);
      expect(view.getFinalizedCheckpoint().root[0], "detached checkpoint bytes").toBe(1);
    }
  });

  it("does not scan blocks or consume a revision for unchanged clock updates", () => {
    const {forkChoice, publish} = setup();
    forkChoice.getAllNodes.mockClear();
    expect(publish(false)).toBeNull();
    expect(forkChoice.getAllNodes).not.toHaveBeenCalled();
    const head = forkChoice.getHead();
    head.executionStatus = ExecutionStatus.Syncing;
    forkChoice.getHead.mockReturnValue(head);
    expect(publish(false)).toBeNull();
    head.executionStatus = ExecutionStatus.Valid;
    expect(publish(false)).toBeNull();
    forkChoice.getFinalizedCheckpoint.mockReturnValue({...forkChoice.getFinalizedCheckpoint(), epoch: 1});
    expect(publish(false)?.revision).toBe(1);
    expect(publish(false)).toBeNull();
  });
  it("does not read or publish diagnostic-only changes", () => {
    const {anchor, forkChoice, publish} = setup();
    anchor.weight = 42n;
    anchor.bestChild = 1;
    forkChoice.getPTCVoteCounts.mockReturnValue({attesterCount: 3, payloadPresentCount: 2, dataAvailableCount: 1});
    forkChoice.getProposerBoostRoot.mockReturnValue(toRootHex(Buffer.alloc(32, 9)));
    expect(publish()).toBeNull();
    expect(publish(false)).toBeNull();
    for (const name of [
      "getPTCVoteCounts",
      "getProposerBoostRoot",
      "getPreviousProposerBoostRoot",
      "getUnrealizedJustifiedCheckpoint",
      "getUnrealizedFinalizedCheckpoint",
      "getFastConfirmationStore",
    ] as const) {
      expect(forkChoice[name], `diagnostic read ${name}`).not.toHaveBeenCalled();
    }
  });

  it("does not access timing audit fields when publishing ChainView metadata", () => {
    const {anchor, publisher} = setup();
    for (const field of ["timeliness", "importedTimely"] as const) {
      Object.defineProperty(anchor, field, {
        get: () => {
          throw Error(`ChainView accessed ${field}`);
        },
      });
    }
    const snapshot = publisher.snapshot();
    expect(snapshot.blocks[0]).not.toHaveProperty("timeliness");
    expect(snapshot.head).not.toHaveProperty("importedTimely");
    expect(publisher.update()).toBeNull();
  });
});
