import {describe, expect, it, vi} from "vitest";
import {CheckpointWithHex, ExecutionStatus, PayloadStatus, ProtoArray, ProtoNode} from "@lodestar/fork-choice";
import {toRootHex} from "@lodestar/utils";
import {ChainViewPublisher} from "../../../../src/chain/beaconEngine/chainView.js";
import {BeaconEngineEvent, BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {ChainView} from "../../../../src/chain/chainView/chainView.js";
import {zeroProtoBlock} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

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
  it("replicates imports, reorgs, same-root execution changes to every subscriber", () => {
    const {anchor, forkChoice, views, publish} = setup();
    const child = {...anchor, blockRoot: toRootHex(Buffer.alloc(32, 2)), parentRoot: anchor.blockRoot, slot: 2};
    forkChoice.getAllNodes.mockReturnValue([anchor, child]);
    forkChoice.getHead.mockReturnValue(child);
    expect(publish()?.blocks.map((b) => b.blockRoot)).toEqual([child.blockRoot]);
    child.executionStatus = ExecutionStatus.Syncing;
    expect(publish()?.blocks).toHaveLength(0);
    for (const view of views) {
      expect(view.isHeadOptimistic(), "head optimism").toBe(true);
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

  it("matches archival traversal across Gloas variants and independent pruning", () => {
    const {forkChoice} = setup();
    const root = (n: number) => toRootHex(Buffer.alloc(32, n));
    const anchor = generateProtoBlock({
      blockRoot: root(1),
      slot: 0,
      executionPayloadBlockHash: root(11),
      executionStatus: ExecutionStatus.Valid,
      executionPayloadNumber: 0,
      executionPayloadGasLimit: 30_000_000,
    });
    const protoArray = ProtoArray.initialize(anchor, 0);
    const add = (n: number, slot: number, parent: number, hash: number) =>
      protoArray.onBlock(
        {
          ...anchor,
          blockRoot: root(n),
          slot,
          parentRoot: root(parent),
          parentBlockHash: root(hash),
          executionPayloadBlockHash: root(hash),
          executionStatus: ExecutionStatus.Valid,
          executionPayloadNumber: slot,
          executionPayloadGasLimit: 30_000_000,
        },
        slot,
        null
      );
    add(2, 1, 1, 11);
    protoArray.onExecutionPayload(
      root(2),
      1,
      root(12),
      1,
      30_000_000,
      null,
      ExecutionStatus.Valid,
      anchor.dataAvailabilityStatus
    );
    add(3, 2, 1, 11);
    add(4, 3, 2, 12);
    forkChoice.getAllNodes.mockImplementation(() => protoArray.nodes);
    forkChoice.getHead.mockImplementation(() => {
      const head = protoArray.nodes.at(-1);
      if (!head) throw Error("Expected proto-array head");
      return head;
    });
    const publisher = new ChainViewPublisher(forkChoice);
    const view = new ChainView(publisher.snapshot());
    const summarize = ({slot, blockRoot, payloadStatus}: ProtoNode) => ({
      slot,
      blockRoot,
      payloadStatus,
    });
    const expected = protoArray.getAllAncestorAndNonAncestorNodes(root(4), PayloadStatus.PENDING);
    expect(view.getFinalizedBlockSnapshot(root(4))).toEqual({
      canonical: expected.ancestors.map(summarize),
      nonCanonical: expected.nonAncestors.map(summarize),
    });
    forkChoice.getHead.mockReturnValue(forkChoice.getHead());
    protoArray.onExecutionPayload(
      root(3),
      2,
      root(13),
      2,
      30_000_000,
      null,
      ExecutionStatus.Valid,
      anchor.dataAvailabilityStatus
    );
    const payloadUpdate = publisher.update();
    if (!payloadUpdate) throw Error("Expected payload update");
    view.applyUpdate(payloadUpdate);
    expect(
      view.getFinalizedBlockSnapshot(root(4)),
      "exclude payload variants imported after the finalized node"
    ).toEqual({
      canonical: expected.ancestors.map(summarize),
      nonCanonical: expected.nonAncestors.map(summarize),
    });
    view.prune({epoch: 1, root: Buffer.alloc(32, 2), rootHex: root(2)});
    const snapshot = view.getFinalizedBlockSnapshot(root(4));
    expect(snapshot.canonical.map((block) => [block.blockRoot, block.payloadStatus])).toEqual([
      [root(4), PayloadStatus.PENDING],
      [root(2), PayloadStatus.FULL],
    ]);
    expect(snapshot.nonCanonical.some((block) => block.blockRoot === root(3))).toBe(false);
    protoArray.pruneThreshold = 0;
    protoArray.maybePrune(root(2));
    expect(publisher.update()).toBeNull();
    expect(view.getFinalizedBlockSnapshot(root(4))).toEqual(snapshot);
  });
});
