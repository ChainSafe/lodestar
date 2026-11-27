import {describe, expect, it, vi} from "vitest";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../src/chain/chain.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("BeaconChain getBlockByRoot and getSerializedBlockByRoot", () => {
  const finalizedSlot = 2 * SLOTS_PER_EPOCH;

  function generateBlock(slot: number): {block: phase0.SignedBeaconBlock; blockRoot: string} {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    return {block, blockRoot: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message))};
  }

  function setup({slot, source}: {slot: number; source: "hotDb" | "blockInput" | "archive"}): {
    block: phase0.SignedBeaconBlock;
    blockRoot: string;
    chain: BeaconChain;
  } {
    const {block, blockRoot} = generateBlock(slot);
    const inForkChoice = source !== "archive";
    const chain = {
      db: {
        block: {
          get: vi.fn(async () => (source === "hotDb" ? block : null)),
          getBinary: vi.fn(async () => (source === "hotDb" ? ssz.phase0.SignedBeaconBlock.serialize(block) : null)),
        },
        blockArchive: {
          getByRoot: vi.fn(async () => (source === "archive" ? block : null)),
          getBinaryEntryByRoot: vi.fn(async () =>
            source === "archive" ? {key: slot, value: ssz.phase0.SignedBeaconBlock.serialize(block)} : null
          ),
        },
      },
      forkChoice: {
        getFinalizedBlock: vi.fn().mockReturnValue(generateProtoBlock({slot: finalizedSlot})),
        getBlockHexDefaultStatus: vi.fn((root: string) =>
          inForkChoice && root === blockRoot ? generateProtoBlock({slot, blockRoot}) : null
        ),
      },
      seenBlockInputCache: {
        get: vi.fn(() =>
          source === "blockInput"
            ? {hasBlock: () => true, getBlock: () => block, slot, forkName: ForkName.phase0}
            : undefined
        ),
      },
      serializedCache: {get: vi.fn().mockReturnValue(undefined)},
    };
    return {block, blockRoot, chain: chain as unknown as BeaconChain};
  }

  it.each([
    ["the finalized block from the hot db", finalizedSlot, "hotDb", true],
    ["the finalized block from the block input cache", finalizedSlot, "blockInput", true],
    ["an unfinalized block from the hot db", finalizedSlot + 1, "hotDb", false],
    ["an unfinalized block from the block input cache", finalizedSlot + 1, "blockInput", false],
    ["an archived block", finalizedSlot - 1, "archive", true],
  ] as const)("reports %s", async (_, slot, source, finalized) => {
    const {block, blockRoot, chain} = setup({slot, source});

    await expect(BeaconChain.prototype.getBlockByRoot.call(chain, blockRoot)).resolves.toEqual({
      block,
      executionOptimistic: false,
      finalized,
    });
    await expect(BeaconChain.prototype.getSerializedBlockByRoot.call(chain, blockRoot)).resolves.toEqual({
      block: ssz.phase0.SignedBeaconBlock.serialize(block),
      executionOptimistic: false,
      finalized,
      slot,
    });
  });
});
