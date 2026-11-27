import {describe, expect, it, vi} from "vitest";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../src/chain/chain.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("BeaconChain getCanonicalBlockAtSlot", () => {
  const finalizedSlot = 2 * SLOTS_PER_EPOCH;

  function generateBlock(slot: number): {block: SignedBeaconBlock; blockRoot: string} {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    return {block, blockRoot: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message))};
  }

  function setup({
    forkChoiceBlocks = [],
    hotBlocks = [],
    archivedBlocks = [],
  }: {
    forkChoiceBlocks?: ProtoBlock[];
    hotBlocks?: {block: SignedBeaconBlock; blockRoot: string}[];
    archivedBlocks?: SignedBeaconBlock[];
  }) {
    const chain = {
      db: {
        block: {
          get: vi.fn(async (root: Uint8Array) => hotBlocks.find((b) => b.blockRoot === toRootHex(root))?.block ?? null),
        },
        blockArchive: {
          get: vi.fn(async (slot: number) => archivedBlocks.find((b) => b.message.slot === slot) ?? null),
        },
      },
      forkChoice: {
        getFinalizedBlock: vi.fn().mockReturnValue(generateProtoBlock({slot: finalizedSlot})),
        getCanonicalBlockAtSlot: vi.fn((slot: number) => forkChoiceBlocks.find((b) => b.slot === slot) ?? null),
        // Fork choice only returns the finalized block and its descendants by root
        getBlockHexDefaultStatus: vi.fn(
          (root: string) => forkChoiceBlocks.find((b) => b.blockRoot === root && b.slot >= finalizedSlot) ?? null
        ),
        getBlockSummariesAtSlot: vi.fn((slot: number) => forkChoiceBlocks.filter((b) => b.slot === slot)),
      },
      seenBlockInputCache: {
        get: vi.fn().mockReturnValue(undefined),
      },
    };

    const getCanonicalBlockAtSlot = (slot: number) =>
      BeaconChain.prototype.getCanonicalBlockAtSlot.call(chain as unknown as BeaconChain, slot);
    return {chain, getCanonicalBlockAtSlot};
  }

  it.each([
    ["the finalized slot", finalizedSlot],
    ["a slot before the finalized slot", finalizedSlot - 1],
  ])("serves a finalized block at %s that is not archived yet", async (_, slot) => {
    const {block, blockRoot} = generateBlock(slot);
    const {getCanonicalBlockAtSlot} = setup({
      forkChoiceBlocks: [generateProtoBlock({slot, blockRoot})],
      hotBlocks: [{block, blockRoot}],
    });

    await expect(getCanonicalBlockAtSlot(slot)).resolves.toEqual({block, executionOptimistic: false, finalized: true});
  });

  it("reports a finalized block that is not archived yet as optimistic while its payload is syncing", async () => {
    const {block, blockRoot} = generateBlock(finalizedSlot);
    const {getCanonicalBlockAtSlot} = setup({
      forkChoiceBlocks: [
        generateProtoBlock({
          slot: finalizedSlot,
          blockRoot,
          executionStatus: ExecutionStatus.Syncing,
          executionPayloadBlockHash: `0x${"bb".repeat(32)}`,
        }),
      ],
      hotBlocks: [{block, blockRoot}],
    });

    await expect(getCanonicalBlockAtSlot(finalizedSlot)).resolves.toEqual({
      block,
      executionOptimistic: true,
      finalized: true,
    });
  });

  it("serves an archived block that is still in fork choice without walking fork choice", async () => {
    const {block, blockRoot} = generateBlock(finalizedSlot);
    const {chain, getCanonicalBlockAtSlot} = setup({
      forkChoiceBlocks: [generateProtoBlock({slot: finalizedSlot, blockRoot})],
      archivedBlocks: [block],
    });

    await expect(getCanonicalBlockAtSlot(finalizedSlot)).resolves.toEqual({
      block,
      executionOptimistic: false,
      finalized: true,
    });
    expect(chain.forkChoice.getCanonicalBlockAtSlot).not.toHaveBeenCalled();
  });

  it("serves an archived block that fork choice has pruned without reading the hot db", async () => {
    const slot = finalizedSlot - SLOTS_PER_EPOCH;
    const {block} = generateBlock(slot);
    const {chain, getCanonicalBlockAtSlot} = setup({archivedBlocks: [block]});

    await expect(getCanonicalBlockAtSlot(slot)).resolves.toEqual({block, executionOptimistic: false, finalized: true});
    expect(chain.db.block.get).not.toHaveBeenCalled();
    expect(chain.forkChoice.getCanonicalBlockAtSlot).not.toHaveBeenCalled();
  });

  it("serves an unfinalized block from the hot db", async () => {
    const slot = finalizedSlot + 1;
    const {block, blockRoot} = generateBlock(slot);
    const {getCanonicalBlockAtSlot} = setup({
      forkChoiceBlocks: [generateProtoBlock({slot, blockRoot})],
      hotBlocks: [{block, blockRoot}],
    });

    await expect(getCanonicalBlockAtSlot(slot)).resolves.toEqual({block, executionOptimistic: false, finalized: false});
  });

  it("returns null for a slot without a canonical block", async () => {
    const {getCanonicalBlockAtSlot} = setup({});

    await expect(getCanonicalBlockAtSlot(finalizedSlot - 1)).resolves.toBeNull();
    await expect(getCanonicalBlockAtSlot(finalizedSlot + 1)).resolves.toBeNull();
  });

  it("returns null for a skipped slot that fork choice assigns to an earlier block", async () => {
    // Fork choice initialized from an unfinalized state puts the finalized block at its epoch start slot
    const {block, blockRoot} = generateBlock(finalizedSlot - 1);
    const {getCanonicalBlockAtSlot} = setup({
      forkChoiceBlocks: [generateProtoBlock({slot: finalizedSlot, blockRoot})],
      hotBlocks: [{block, blockRoot}],
    });

    await expect(getCanonicalBlockAtSlot(finalizedSlot)).resolves.toBeNull();
  });
});
