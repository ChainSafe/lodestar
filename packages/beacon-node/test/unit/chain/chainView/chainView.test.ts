import {describe, expect, it} from "vitest";
import {CheckpointWithHex, PayloadStatus} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {toRootHex} from "@lodestar/utils";
import {toChainViewBlock} from "../../../../src/chain/beaconEngine/chainView.js";
import {ChainViewBlock, ChainViewSnapshot} from "../../../../src/chain/chainView/interface.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
import {zeroProtoBlock} from "../../../utils/state.js";

const root = (n: number) => toRootHex(Buffer.alloc(32, n));
const checkpoint = (n: number, epoch = 0): CheckpointWithHex => ({root: Buffer.alloc(32, n), rootHex: root(n), epoch});
function block(n: number, slot: number, parent: number, extra: Partial<ChainViewBlock> = {}): ChainViewBlock {
  return {...toChainViewBlock(zeroProtoBlock), blockRoot: root(n), slot, parentRoot: root(parent), ...extra};
}
function snapshot(blocks: ChainViewBlock[], head = blocks.at(-1)): ChainViewSnapshot {
  if (!head) throw new Error("Snapshot requires a head");
  return {
    blocks,
    head,
    justified: checkpoint(1),
    finalized: checkpoint(1),
    version: 0,
  };
}
function update(initial: ChainViewSnapshot, changes: Partial<ChainViewSnapshot>): ChainViewSnapshot {
  return {...initial, blocks: [], ...changes};
}

describe("ChainView", () => {
  it("applies imported blocks and checkpoint metadata", () => {
    const a = block(1, 0, 0);
    const b = block(2, SLOTS_PER_EPOCH - 1, 1);
    const initial = snapshot([a]);
    const view = new ReplicateChainView(initial);
    const isCurrent = view.onChainViewUpdate({
      blocks: [b],
      state: {head: b, justified: checkpoint(2, 1), finalized: checkpoint(2, 1)},
      version: 1,
    });
    expect(isCurrent).toBe(true);
    expect(view.version).toBe(1);
    expect(view.getHead()).toEqual(b);
    expect(view.getFinalizedBlock()).toEqual(b);
    expect(view.getJustifiedBlock()).toEqual(b);
  });

  it("merges late blocks without rolling back head or checkpoints", () => {
    const a = block(1, 0, 0);
    const b = block(2, SLOTS_PER_EPOCH - 1, 1);
    const c = block(3, SLOTS_PER_EPOCH, 2);
    const initial = {
      ...snapshot([a, b, c]),
      justified: checkpoint(2, 1),
      finalized: checkpoint(2, 1),
      version: 5,
    };
    const view = new ReplicateChainView(initial);
    const late = block(4, SLOTS_PER_EPOCH - 2, 1);

    expect(view.onChainViewUpdate({blocks: [late], state: snapshot([a, late]), version: 4})).toBe(false);
    expect(view.hasBlockHexUnsafe(late.blockRoot)).toBe(true);
    expect(view.hasBlockHex(late.blockRoot)).toBe(false);
    expect(view.getHead()).toEqual(c);
    expect(view.getJustifiedCheckpoint()).toEqual(initial.justified);
    expect(view.getFinalizedCheckpoint()).toEqual(initial.finalized);
    expect(view.version).toBe(5);
    expect(view.onChainViewUpdate({blocks: [], state: initial, version: 5})).toBe(true);
  });

  it("adds returned FULL metadata without changing head or checkpoints", () => {
    const a = block(1, 0, 0);
    const pending = block(2, 1, 1, {payloadStatus: PayloadStatus.PENDING});
    const empty = {...pending, payloadStatus: PayloadStatus.EMPTY};
    const full = {...pending, payloadStatus: PayloadStatus.FULL, executionPayloadBlockHash: root(3)};
    const initial = snapshot([a]);
    const view = new ReplicateChainView(initial);
    view.onChainViewUpdate({
      blocks: [pending],
      state: {head: empty, justified: initial.justified, finalized: initial.finalized},
    });
    expect(view.getBlockHex(pending.blockRoot, PayloadStatus.PENDING)).toEqual(pending);
    expect(view.getBlockHex(pending.blockRoot, PayloadStatus.EMPTY)).toEqual(empty);
    expect(view.hasPayloadHexUnsafe(pending.blockRoot)).toBe(false);
    const finalized = view.getFinalizedCheckpoint();
    const justified = view.getJustifiedCheckpoint();
    view.onChainViewUpdate({blocks: [full]});
    view.onChainViewUpdate({blocks: [full]});
    expect(view.getBlockHex(full.blockRoot, PayloadStatus.FULL)).toEqual(full);
    expect(view.getHead()).toEqual(empty);
    expect(view.getFinalizedCheckpoint()).toEqual(finalized);
    expect(view.getJustifiedCheckpoint()).toEqual(justified);
    view.onChainViewUpdate({blocks: [full], state: {...initial, head: full}});
    expect(view.getHead()).toEqual(full);
  });

  it("does not restore pruned blocks when a payload result arrives late", () => {
    const a = block(1, 0, 0);
    const b = block(2, 2, 1);
    const c = block(3, SLOTS_PER_EPOCH - 1, 2);
    const initial = snapshot([a, b, c], c);
    const view = new ReplicateChainView(initial);
    view.applyFinalizedCheckpoint(checkpoint(3, 1));
    view.prune(checkpoint(3, 1));
    view.onChainViewUpdate({blocks: [b]});
    expect(view.hasBlockHexUnsafe(b.blockRoot)).toBe(false);
    expect(view.getFinalizedBlock()).toEqual(c);
  });

  it("walks skipped slots and switches branches without a canonical slot index", () => {
    const a = block(1, 0, 0);
    const b = block(2, 2, 1);
    const c = block(3, 4, 2);
    const d = block(4, 3, 1);
    const initial = snapshot([a, b, c, d], c);
    const view = new ReplicateChainView(initial);
    expect(view.getCanonicalProtoBlockAtSlot(3)).toBeNull();
    expect(view.getCanonicalBlockClosestLteSlot(3)?.blockRoot).toBe(b.blockRoot);
    const captured = view.getCanonicalBlockRootSlotsByRange(1, 5);
    view.onChainViewUpdate({blocks: [], state: {...initial, head: d}});
    expect(view.getCanonicalProtoBlockAtSlot(2)).toBeNull();
    expect(view.getCanonicalBlockByRoot(Buffer.alloc(32, 4))?.slot).toBe(3);
    expect(captured.nonFinalized.map((entry) => entry.slot)).toEqual([2, 4]);
    expect(view.getCanonicalBlockRootSlotsByRange(1, 5).nonFinalized.map((entry) => entry.slot)).toEqual([3]);
    expect(view.hasBlockHex(c.blockRoot)).toBe(true);
  });

  it.each([false, true])(
    "distinguishes finalized ancestry from retained membership (checkpoint only: %s)",
    (checkpointOnly) => {
      const a = block(1, 0, 0);
      const finalized = block(2, SLOTS_PER_EPOCH - 1, 1);
      const canonical = block(3, SLOTS_PER_EPOCH + 2, 2);
      const orphan = block(4, SLOTS_PER_EPOCH + 3, 1);
      const initial = snapshot([a, finalized, canonical, orphan], canonical);
      const view = new ReplicateChainView(initial);
      expect(view.hasBlockHex(orphan.blockRoot)).toBe(true);
      const finalization = update(initial, {finalized: checkpoint(2, 1), justified: checkpoint(2, 1)});
      if (checkpointOnly) {
        view.applyFinalizedCheckpoint(finalization.finalized);
        view.applyFinalizedCheckpoint(initial.finalized);
        expect(view.getHead()).toEqual(canonical);
        expect(view.getJustifiedCheckpoint()).toBe(initial.justified);
      } else {
        view.onChainViewUpdate({blocks: finalization.blocks, state: finalization});
      }
      expect(view.getFinalizedBlock().slot).toBe(SLOTS_PER_EPOCH - 1);
      expect(view.hasBlockHex(orphan.blockRoot)).toBe(false);
      expect(view.hasBlockHexUnsafe(orphan.blockRoot)).toBe(true);
      expect(view.hasBlockHex(canonical.blockRoot)).toBe(true);
      expect(view.hasBlockHex(finalized.blockRoot)).toBe(true);
      view.prune(finalization.finalized);
      view.onChainViewUpdate({blocks: [orphan, a], state: finalization});
      expect(view.hasBlockHexUnsafe(orphan.blockRoot)).toBe(false);
      expect(view.getAllAncestorBlocks(canonical.blockRoot, PayloadStatus.FULL).map((b) => b.blockRoot)).toEqual([
        canonical.blockRoot,
        finalized.blockRoot,
      ]);
    }
  );

  it("selects EMPTY or FULL ancestors by execution hash, independently of payload availability", () => {
    const a = block(1, 0, 0, {executionPayloadBlockHash: root(10)});
    const pending = block(2, 1, 1, {
      payloadStatus: PayloadStatus.PENDING,
      parentBlockHash: root(10),
      executionPayloadBlockHash: root(10),
    });
    const empty = {...pending, payloadStatus: PayloadStatus.EMPTY};
    const full = {...pending, payloadStatus: PayloadStatus.FULL, executionPayloadBlockHash: root(20)};
    const child = block(3, 2, 2, {
      payloadStatus: PayloadStatus.EMPTY,
      parentBlockHash: root(10),
      executionPayloadBlockHash: root(10),
    });
    const initial = snapshot([a, pending, empty, full, child]);
    const view = new ReplicateChainView(initial);
    expect(view.hasPayloadHexUnsafe(pending.blockRoot)).toBe(true);
    expect(view.getBlockHexDefaultStatus(pending.blockRoot)?.payloadStatus).toBe(PayloadStatus.PENDING);
    expect(view.getAllAncestorBlocks(child.blockRoot, child.payloadStatus).map((b) => b.payloadStatus)).toEqual([
      PayloadStatus.EMPTY,
      PayloadStatus.EMPTY,
      PayloadStatus.FULL,
    ]);
    expect(view.getFullBlockRootSlotsByRange(1, 3).nonFinalized).toEqual([]);
    expect(view.isDescendant(root(2), PayloadStatus.FULL, child.blockRoot, child.payloadStatus)).toBe(false);
    expect(view.isDescendant(root(2), PayloadStatus.EMPTY, child.blockRoot, child.payloadStatus)).toBe(true);
    expect(view.isDescendant(root(2), PayloadStatus.PENDING, child.blockRoot, child.payloadStatus)).toBe(true);
    expect(view.isDescendant(root(99), PayloadStatus.FULL, child.blockRoot, child.payloadStatus)).toBe(false);
    const otherChild = block(4, 3, 2, {
      payloadStatus: PayloadStatus.EMPTY,
      parentBlockHash: root(20),
      executionPayloadBlockHash: root(20),
    });
    view.onChainViewUpdate({blocks: [otherChild], state: {...initial, head: otherChild}});
    expect(view.getCanonicalProtoBlockAtSlot(1)?.payloadStatus).toBe(PayloadStatus.FULL);
    expect(view.isDescendant(root(2), PayloadStatus.FULL, otherChild.blockRoot, otherChild.payloadStatus)).toBe(true);
    expect(view.isDescendant(root(2), PayloadStatus.EMPTY, otherChild.blockRoot, otherChild.payloadStatus)).toBe(false);
    expect(view.getFullBlockRootSlotsByRange(1, 4).nonFinalized.map((b) => b.slot)).toEqual([1]);
    expect(view.getAllAncestorBlocks(pending.blockRoot, PayloadStatus.PENDING).map((b) => b.blockRoot)).toEqual([
      a.blockRoot,
    ]);
  });

  it("applies same-root payload changes", () => {
    const a = block(1, 0, 0);
    const pending = block(2, 1, 1, {payloadStatus: PayloadStatus.PENDING});
    const initial = snapshot([a, pending]);
    const view = new ReplicateChainView(initial);
    const full = {...pending, payloadStatus: PayloadStatus.FULL};
    const next = update(initial, {blocks: [full], head: full});
    view.onChainViewUpdate({blocks: next.blocks, state: next});
    expect(view.getHead().slot).toBe(1);
    expect(view.getHead().payloadStatus).toBe(PayloadStatus.FULL);
    expect(view.getHead()).not.toHaveProperty("executionStatus");
    expect(view.hasPayloadHexUnsafe(full.blockRoot)).toBe(true);
  });

  it("keeps finalized Gloas variants and accepts descendants in an unordered late batch", () => {
    const a = block(1, 0, 0);
    const pending = block(2, SLOTS_PER_EPOCH - 2, 1, {payloadStatus: PayloadStatus.PENDING});
    const empty = {...pending, payloadStatus: PayloadStatus.EMPTY};
    const full = {...pending, payloadStatus: PayloadStatus.FULL};
    const initial = snapshot([a, pending, empty, full], full);
    const view = new ReplicateChainView(initial);
    const finalization = update(initial, {finalized: checkpoint(2, 1), justified: checkpoint(2, 1)});
    view.onChainViewUpdate({blocks: finalization.blocks, state: finalization});
    view.prune(finalization.finalized);
    for (const variant of [pending, empty, full]) {
      expect(view.getBlockHex(variant.blockRoot, variant.payloadStatus), "retained boundary variant").toEqual(variant);
    }
    const child = block(3, SLOTS_PER_EPOCH + 1, 2);
    const grandchild = block(4, SLOTS_PER_EPOCH + 2, 3);
    const orphan = block(5, SLOTS_PER_EPOCH + 1, 1);
    view.onChainViewUpdate({blocks: [grandchild, orphan, child, a], state: {...finalization, head: grandchild}});
    expect(view.hasBlockHexUnsafe(a.blockRoot)).toBe(false);
    expect(view.hasBlockHexUnsafe(orphan.blockRoot)).toBe(false);
    expect(view.hasBlockHex(grandchild.blockRoot)).toBe(true);
  });

  it("prunes to the completed archive checkpoint when fork choice has finalized further", () => {
    const a = block(1, 0, 0);
    const b = block(2, SLOTS_PER_EPOCH - 1, 1);
    const c = block(3, 2 * SLOTS_PER_EPOCH - 1, 2);
    const d = block(4, 2 * SLOTS_PER_EPOCH + 1, 3);
    const initial = snapshot([a, b, c, d]);
    const view = new ReplicateChainView(initial);
    view.onChainViewUpdate({blocks: [], state: {...initial, finalized: checkpoint(3, 2), justified: checkpoint(3, 2)}});
    view.prune(checkpoint(2, 1));
    expect(view.hasBlockHexUnsafe(b.blockRoot)).toBe(true);
    expect(view.hasBlockHexUnsafe(a.blockRoot)).toBe(false);
    view.prune(checkpoint(3, 2));
    view.prune(checkpoint(2, 1));
    expect(view.hasBlockHexUnsafe(b.blockRoot)).toBe(false);
    expect(view.getFinalizedBlock()).toEqual(c);
    expect(view.getCanonicalProtoBlockAtSlot(d.slot)).toEqual(d);
  });
});
