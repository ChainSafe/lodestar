import {beforeEach, describe, expect, it, vi} from "vitest";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {ApiError, ValidationError} from "../../../../../../src/api/impl/errors.js";
import {IBeaconEngineCoreApi} from "../../../../../../src/chain/beaconEngine/interface.js";
import {withBeaconEngineFacade} from "../../../../../mocks/mockedBeaconChain.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock, generateSignedBlockAtSlot} from "../../../../../utils/typeGenerator.js";

describe("getBlockRoot", () => {
  const headRoot = `0x${"aa".repeat(32)}`;
  const slotZeroRoot = Buffer.alloc(32, 0x11);
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconBlockApi>;
  const getCanonicalBlockAtSlot = vi.fn<IBeaconEngineCoreApi["getCanonicalBlockAtSlot"]>();
  const getBlockByRoot = vi.fn<IBeaconEngineCoreApi["getBlockByRoot"]>();

  function getRootHex(res: Awaited<ReturnType<typeof api.getBlockRoot>>): string {
    if (res.data instanceof Uint8Array) {
      throw Error("Expected root response object");
    }
    return toRootHex(res.data.root);
  }

  beforeEach(() => {
    modules = getApiTestModules();
    const chain = withBeaconEngineFacade(modules.chain);
    getCanonicalBlockAtSlot.mockReset();
    modules.chain.getCanonicalBlockAtSlot = getCanonicalBlockAtSlot;
    getBlockByRoot.mockReset();
    modules.chain.getBlockByRoot = getBlockByRoot;
    api = getBeaconBlockApi({...modules, chain});
    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 10, blockRoot: headRoot}));
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: new Uint8Array(32),
      rootHex: `0x${"00".repeat(32)}`,
    });
    modules.forkChoice.getCanonicalBlockClosestLteSlot.mockReturnValue(
      generateProtoBlock({slot: 0, blockRoot: toRootHex(slotZeroRoot)})
    );
  });

  it("returns the head root for the head id and for the head slot", async () => {
    expect(getRootHex(await api.getBlockRoot({blockId: "head"}))).toBe(headRoot);
    expect(getRootHex(await api.getBlockRoot({blockId: 10}))).toBe(headRoot);
    expect(getBlockByRoot).not.toHaveBeenCalled();
  });

  it("reads a recent skipped slot from engine fork choice", async () => {
    const recentRoot = Buffer.alloc(32, 0x22);
    modules.forkChoice.getCanonicalBlockClosestLteSlot.mockReturnValue(
      generateProtoBlock({slot: 3, blockRoot: toRootHex(recentRoot)})
    );

    const res = await api.getBlockRoot({blockId: 4});

    expect(modules.forkChoice.getCanonicalBlockClosestLteSlot).toHaveBeenCalledWith(4);
    expect(getRootHex(res)).toBe(toRootHex(recentRoot));
    expect(res.meta.finalized).toBe(true);
    expect(getBlockByRoot).not.toHaveBeenCalled();
  });

  it("serves a block root id that parseInt would read as a recent slot", async () => {
    const blockId = `0x${"00".repeat(31)}05`;
    const block = generateSignedBlockAtSlot(4);
    getBlockByRoot.mockResolvedValue({
      block: modules.config.getForkTypes(4).SignedBeaconBlock.serialize(block),
      slot: 4,
      executionOptimistic: false,
      finalized: false,
    });

    const res = await api.getBlockRoot({blockId});

    expect(getBlockByRoot).toHaveBeenCalledWith(fromHex(blockId));
    expect(getRootHex(res)).toBe(
      toRootHex(modules.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message))
    );
  });

  it("serves a block root id while the head is inside the historical root window", async () => {
    const blockId = `0x${"ab".repeat(32)}`;
    const block = generateSignedBlockAtSlot(4);
    getBlockByRoot.mockResolvedValue({
      block: modules.config.getForkTypes(4).SignedBeaconBlock.serialize(block),
      slot: 4,
      executionOptimistic: false,
      finalized: false,
    });

    const res = await api.getBlockRoot({blockId});

    expect(getBlockByRoot).toHaveBeenCalledWith(fromHex(blockId));
    expect(getRootHex(res)).toBe(
      toRootHex(modules.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message))
    );
    expect(getRootHex(res)).not.toBe(toRootHex(slotZeroRoot));
  });

  it("loads a slot older than the historical root window from the block archive", async () => {
    const slot = 10 + SLOTS_PER_HISTORICAL_ROOT;
    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot, blockRoot: headRoot}));
    const block = generateSignedBlockAtSlot(1);
    getCanonicalBlockAtSlot.mockResolvedValue({
      block: modules.config.getForkTypes(1).SignedBeaconBlock.serialize(block),
      slot: 1,
      executionOptimistic: true,
      finalized: true,
    });

    const res = await api.getBlockRoot({blockId: 1});

    expect(getCanonicalBlockAtSlot).toHaveBeenCalledWith(1);
    expect(res.meta).toEqual({executionOptimistic: true, finalized: true});
  });

  it("reads current head optimism without a ChainView update", async () => {
    const head = generateProtoBlock({slot: 10, blockRoot: headRoot, executionStatus: ExecutionStatus.Syncing});
    modules.forkChoice.getHead.mockReturnValue(head);
    expect((await api.getBlockRoot({blockId: "head"})).meta.executionOptimistic).toBe(true);
    head.executionStatus = ExecutionStatus.Valid;
    expect((await api.getBlockRoot({blockId: 10})).meta.executionOptimistic).toBe(false);
  });

  it.each(["genesis", "finalized", "justified"] as const)("resolves %s inside Core", async (blockId) => {
    const block = generateSignedBlockAtSlot(0);
    const summary = generateProtoBlock({blockRoot: toRootHex(slotZeroRoot)});
    modules.forkChoice.getFinalizedBlock.mockReturnValue(summary);
    modules.forkChoice.getJustifiedBlock.mockReturnValue(summary);
    const res = {
      block: modules.config.getForkTypes(0).SignedBeaconBlock.serialize(block),
      slot: 0,
      executionOptimistic: false,
      finalized: true,
    };
    getBlockByRoot.mockResolvedValue(res);
    getCanonicalBlockAtSlot.mockResolvedValue(res);
    expect((await api.getBlockRoot({blockId})).meta).toEqual({executionOptimistic: false, finalized: true});
    if (blockId === "genesis") expect(getCanonicalBlockAtSlot).toHaveBeenCalledWith(0);
    else expect(getBlockByRoot).toHaveBeenCalledWith(Uint8Array.from(slotZeroRoot));
  });

  it("passes root identifiers to Core as bytes", async () => {
    const getBlockRoot = vi.spyOn(modules.chain.beaconEngine, "getBlockRoot");
    getBlockByRoot.mockResolvedValue(null);
    await expect(api.getBlockRoot({blockId: headRoot})).rejects.toMatchObject({statusCode: 404});
    expect(getBlockRoot).toHaveBeenCalledWith(fromHex(headRoot));
  });

  it.each(["invalid", "0x1234"])("preserves validation errors for %s", async (blockId) => {
    await expect(api.getBlockRoot({blockId})).rejects.toEqual(
      new ValidationError(`Invalid block id '${blockId}'`, "blockId")
    );
    expect(getBlockByRoot).not.toHaveBeenCalled();
    expect(getCanonicalBlockAtSlot).not.toHaveBeenCalled();
  });

  it("preserves not-found errors after the recent-slot fallback", async () => {
    modules.forkChoice.getCanonicalBlockClosestLteSlot.mockReturnValue(null);
    getCanonicalBlockAtSlot.mockResolvedValue(null);
    await expect(api.getBlockRoot({blockId: 3})).rejects.toEqual(new ApiError(404, "Block not found for id '3'"));
    expect(getCanonicalBlockAtSlot).toHaveBeenCalledWith(3);
  });
});
