import {beforeEach, describe, expect, it, vi} from "vitest";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock, generateSignedBlockAtSlot} from "../../../../../utils/typeGenerator.js";

describe("getBlockRoot", () => {
  const headRoot = `0x${"aa".repeat(32)}`;
  const slotZeroRoot = Buffer.alloc(32, 0x11);
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconBlockApi>;

  function getRootHex(res: Awaited<ReturnType<typeof api.getBlockRoot>>): string {
    if (res.data instanceof Uint8Array) {
      throw Error("Expected root response object");
    }
    return toRootHex(res.data.root);
  }

  beforeEach(() => {
    modules = getApiTestModules();
    api = getBeaconBlockApi(modules);
    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 10, blockRoot: headRoot}));
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: new Uint8Array(32),
      rootHex: `0x${"00".repeat(32)}`,
    });
    modules.chain.getHeadState.mockReturnValue({
      getBlockRootAtSlot: vi.fn().mockReturnValue(slotZeroRoot),
    } as never);
  });

  it("returns the head root for the head id and for the head slot", async () => {
    expect(getRootHex(await api.getBlockRoot({blockId: "head"}))).toBe(headRoot);
    expect(getRootHex(await api.getBlockRoot({blockId: 10}))).toBe(headRoot);
    expect(modules.chain.getBlockByRoot).not.toHaveBeenCalled();
  });

  it("reads a recent slot from the head state", async () => {
    const recentRoot = Buffer.alloc(32, 0x22);
    vi.mocked(modules.chain.getHeadState().getBlockRootAtSlot).mockReturnValue(recentRoot);

    const res = await api.getBlockRoot({blockId: 3});

    expect(modules.chain.getHeadState().getBlockRootAtSlot).toHaveBeenCalledWith(3);
    expect(getRootHex(res)).toBe(toRootHex(recentRoot));
    expect(res.meta.finalized).toBe(true);
    expect(modules.chain.getBlockByRoot).not.toHaveBeenCalled();
  });

  it("serves a block root id that parseInt would read as a recent slot", async () => {
    const blockId = `0x${"00".repeat(31)}05`;
    const block = generateSignedBlockAtSlot(4);
    modules.chain.getBlockByRoot.mockResolvedValue({block, executionOptimistic: false, finalized: false});

    const res = await api.getBlockRoot({blockId});

    expect(modules.chain.getBlockByRoot).toHaveBeenCalledWith(blockId);
    expect(getRootHex(res)).toBe(
      toRootHex(modules.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message))
    );
  });

  it("serves a block root id while the head is inside the historical root window", async () => {
    const blockId = `0x${"ab".repeat(32)}`;
    const block = generateSignedBlockAtSlot(4);
    modules.chain.getBlockByRoot.mockResolvedValue({block, executionOptimistic: false, finalized: false});

    const res = await api.getBlockRoot({blockId});

    expect(modules.chain.getBlockByRoot).toHaveBeenCalledWith(blockId);
    expect(getRootHex(res)).toBe(
      toRootHex(modules.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message))
    );
    expect(getRootHex(res)).not.toBe(toRootHex(slotZeroRoot));
  });

  it("loads a slot older than the historical root window from the block archive", async () => {
    const slot = 10 + SLOTS_PER_HISTORICAL_ROOT;
    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot, blockRoot: headRoot}));
    const block = generateSignedBlockAtSlot(1);
    modules.chain.getCanonicalBlockAtSlot.mockResolvedValue({block, executionOptimistic: true, finalized: true});

    const res = await api.getBlockRoot({blockId: 1});

    expect(modules.chain.getCanonicalBlockAtSlot).toHaveBeenCalledWith(1);
    expect(res.meta).toEqual({executionOptimistic: true, finalized: true});
  });
});
