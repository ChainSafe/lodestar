import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkChoice, ForkChoiceStore, PayloadStatus, ProtoArray, ProtoBlock} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {fromHex, toRootHex} from "@lodestar/utils";
import type {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {toChainViewBlock} from "../../../../src/chain/beaconEngine/utils.js";
import {ForkChoiceChainView} from "../../../../src/chain/chainView/forkChoiceChainView.js";
import {ChainViewBlock, IChainView} from "../../../../src/chain/chainView/interface.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
import {zeroProtoBlock} from "../../../utils/state.js";

const VALIDATOR_COUNT = 4;
const root = (n: number) => toRootHex(Buffer.alloc(32, n));

/**
 * anchor(0) - finalized(SLOTS_PER_EPOCH - 1) - a(SLOTS_PER_EPOCH + 1) - head(SLOTS_PER_EPOCH + 3)
 *          \                                 \- sibling(SLOTS_PER_EPOCH + 2)
 *           \- orphan(SLOTS_PER_EPOCH + 2), forked before the finalized checkpoint
 */
function buildForkChoice(): {forkChoice: ForkChoice; blocks: Record<string, ProtoBlock>} {
  const finalizedCp = {epoch: 1, root: fromHex(root(2))};
  const anchor: ProtoBlock = {...zeroProtoBlock, blockRoot: root(1), parentRoot: root(0), targetRoot: root(1)};
  const justifiedFields = {
    justifiedEpoch: 1,
    justifiedRoot: root(2),
    finalizedEpoch: 1,
    finalizedRoot: root(2),
    unrealizedJustifiedEpoch: 1,
    unrealizedJustifiedRoot: root(2),
    unrealizedFinalizedEpoch: 1,
    unrealizedFinalizedRoot: root(2),
  };
  const child = (
    n: number,
    slot: number,
    parent: ProtoBlock,
    extra: Partial<typeof justifiedFields> = {}
  ): ProtoBlock => ({
    ...anchor,
    blockRoot: root(n),
    parentRoot: parent.blockRoot,
    stateRoot: root(n + 100),
    targetRoot: root(n),
    slot,
    ...extra,
  });
  const finalized = child(2, SLOTS_PER_EPOCH - 1, anchor);
  const a = child(3, SLOTS_PER_EPOCH + 1, finalized, justifiedFields);
  const sibling = child(4, SLOTS_PER_EPOCH + 2, a, justifiedFields);
  const head = child(5, SLOTS_PER_EPOCH + 3, a, justifiedFields);
  const orphan = child(6, SLOTS_PER_EPOCH + 2, anchor);

  const currentSlot = SLOTS_PER_EPOCH + 4;
  const protoArray = ProtoArray.initialize(anchor, currentSlot);
  for (const block of [finalized, a, sibling, head, orphan]) protoArray.onBlock(block, currentSlot, null);
  const balances = new Uint16Array(VALIDATOR_COUNT).fill(32);
  const store = new ForkChoiceStore(
    currentSlot,
    finalizedCp,
    finalizedCp,
    balances,
    () => balances,
    () => null
  );
  const forkChoice = new ForkChoice(config, store, protoArray, VALIDATOR_COUNT, null);
  forkChoice.updateHead();
  return {forkChoice, blocks: {anchor, finalized, a, sibling, head, orphan}};
}

function buildViews(): {views: [string, IChainView][]; blocks: Record<string, ProtoBlock>} {
  const {forkChoice, blocks} = buildForkChoice();
  const replica = new ReplicateChainView({
    blocks: forkChoice.getAllNodes().map(toChainViewBlock),
    head: toChainViewBlock(forkChoice.getHead()),
    justified: forkChoice.getJustifiedCheckpoint(),
    finalized: forkChoice.getFinalizedCheckpoint(),
    version: 0,
  });
  const core = {forkChoice, forkChoiceVersion: 0} as unknown as BeaconEngineCore;
  return {
    views: [
      ["ReplicateChainView", replica],
      ["ForkChoiceChainView", new ForkChoiceChainView(core)],
    ],
    blocks,
  };
}

const pick = (block: ChainViewBlock | null): ChainViewBlock | null => block && toChainViewBlock(block as ProtoBlock);
const roots = (blocks: ChainViewBlock[]): string[] => blocks.map((block) => block.blockRoot).sort();

/** Every IChainView read must return the same thing from the replica and from fork choice */
describe("IChainView contract", () => {
  const {views, blocks} = buildViews();
  const results = (read: (view: IChainView) => unknown): unknown[] => views.map(([, view]) => read(view));
  const {anchor, finalized, a, sibling, head, orphan} = blocks;

  const cases: [string, (view: IChainView) => unknown][] = [
    ["getHead", (view) => pick(view.getHead())],
    ["getHeadRoot", (view) => view.getHeadRoot()],
    ["getFinalizedCheckpoint", (view) => view.getFinalizedCheckpoint().rootHex],
    ["getJustifiedCheckpoint", (view) => view.getJustifiedCheckpoint().rootHex],
    ["getFinalizedBlock", (view) => pick(view.getFinalizedBlock())],
    ["hasBlockHex", (view) => [anchor, finalized, a, sibling, head, orphan].map((b) => view.hasBlockHex(b.blockRoot))],
    ["hasBlockHexUnsafe", (view) => [orphan, head].map((b) => view.hasBlockHexUnsafe(b.blockRoot))],
    ["hasPayloadHexUnsafe", (view) => view.hasPayloadHexUnsafe(head.blockRoot)],
    [
      "getBlockHexDefaultStatus",
      (view) => [orphan, sibling].map((b) => pick(view.getBlockHexDefaultStatus(b.blockRoot))),
    ],
    ["getBlockHex", (view) => pick(view.getBlockHex(a.blockRoot, PayloadStatus.FULL))],
    [
      "getCanonicalProtoBlockAtSlot",
      (view) => [SLOTS_PER_EPOCH + 1, SLOTS_PER_EPOCH + 2].map((slot) => pick(view.getCanonicalProtoBlockAtSlot(slot))),
    ],
    ["getCanonicalBlockClosestLteSlot", (view) => pick(view.getCanonicalBlockClosestLteSlot(SLOTS_PER_EPOCH + 2))],
    [
      "getCanonicalBlockByRoot",
      (view) => [sibling, a].map((b) => pick(view.getCanonicalBlockByRoot(fromHex(b.blockRoot)))),
    ],
    ["getBlockSummariesByParentRoot", (view) => roots(view.getBlockSummariesByParentRoot(a.blockRoot))],
    [
      "isDescendant",
      (view) => [
        view.isDescendant(a.blockRoot, PayloadStatus.FULL, head.blockRoot, PayloadStatus.FULL),
        view.isDescendant(sibling.blockRoot, PayloadStatus.FULL, head.blockRoot, PayloadStatus.FULL),
      ],
    ],
    ["getAllAncestorBlocks", (view) => view.getAllAncestorBlocks(head.blockRoot, PayloadStatus.FULL).map(pick)],
    ["getCanonicalBlockRootSlotsByRange", (view) => view.getCanonicalBlockRootSlotsByRange(0, SLOTS_PER_EPOCH * 2)],
    ["getFullBlockRootSlotsByRange", (view) => view.getFullBlockRootSlotsByRange(0, SLOTS_PER_EPOCH * 2)],
  ];

  it.each(cases)("%s", (_name, read) => {
    const [replica, forkChoice] = results(read);
    expect(replica).toEqual(forkChoice);
  });

  it("reads a non-trivial chain", () => {
    for (const [name, view] of views) {
      expect(view.getHeadRoot(), name).toBe(head.blockRoot);
      expect(view.getFinalizedBlock().blockRoot, name).toBe(finalized.blockRoot);
      expect(view.getCanonicalBlockByRoot(fromHex(sibling.blockRoot)), name).toBeNull();
      expect(roots(view.getBlockSummariesByParentRoot(a.blockRoot)), name).toEqual(
        roots([sibling, head].map(toChainViewBlock))
      );
      expect(view.getCanonicalBlockRootSlotsByRange(0, SLOTS_PER_EPOCH * 2).nonFinalized.length, name).toBe(2);
    }
  });

  it("filters blocks that do not descend from the finalized checkpoint", () => {
    for (const [name, view] of views) {
      expect(view.hasBlockHex(orphan.blockRoot), name).toBe(false);
      expect(view.hasBlockHex(head.blockRoot), name).toBe(true);
    }
  });
});
