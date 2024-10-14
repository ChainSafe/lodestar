import {toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, vi, afterEach} from "vitest";
import {when} from "vitest-when";
import {routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock, generateSignedBlockAtSlot} from "../../../../../utils/typeGenerator.js";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";

describe("api - beacon - getBlockHeaders", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconBlockApi>;
  const parentRoot = toHexString(Buffer.alloc(32, 1));

  beforeEach(() => {
    modules = getApiTestModules();
    api = getBeaconBlockApi(modules);

    vi.spyOn(modules.db.block, "get");
    vi.spyOn(modules.db.blockArchive, "getByParentRoot");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.skip("no filters - assume head slot", async () => {
    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 1}));
    when(modules.chain.getCanonicalBlockAtSlot)
      .calledWith(1)
      .thenResolve({block: ssz.phase0.SignedBeaconBlock.defaultValue(), executionOptimistic: false, finalized: false});
    when(modules.forkChoice.getBlockSummariesAtSlot)
      .calledWith(1)
      .thenReturn([
        generateProtoBlock(),
        //canonical block summary
        {
          ...generateProtoBlock(),
          blockRoot: toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(ssz.phase0.BeaconBlock.defaultValue())),
        },
      ]);

    const blockFromDb3 = ssz.phase0.SignedBeaconBlock.defaultValue();
    blockFromDb3.message.slot = 3;
    modules.db.block.get.mockResolvedValue(blockFromDb3);

    modules.db.blockArchive.get.mockResolvedValue(null);
    const {data: blockHeaders} = (await api.getBlockHeaders({})) as {data: routes.beacon.BlockHeaderResponse[]};
    expect(blockHeaders).not.toBeNull();
    expect(blockHeaders.length).toBe(2);
    expect(blockHeaders.filter((header) => header.canonical).length).toBe(1);
    expect(modules.forkChoice.getHead).toHaveBeenCalledTimes(1);
    expect(modules.chain.getCanonicalBlockAtSlot).toHaveBeenCalledTimes(1);
    expect(modules.forkChoice.getBlockSummariesAtSlot).toHaveBeenCalledTimes(1);
    expect(modules.db.block.get).toHaveBeenCalledTimes(1);
  });

  it("future slot", async () => {
    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 1}));
    const {data: blockHeaders} = await api.getBlockHeaders({slot: 2});
    expect(blockHeaders.length).toBe(0);
  });

  it("finalized slot", async () => {
    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 2}));
    when(modules.chain.getCanonicalBlockAtSlot)
      .calledWith(0)
      .thenResolve({block: ssz.phase0.SignedBeaconBlock.defaultValue(), executionOptimistic: false, finalized: false});
    when(modules.forkChoice.getBlockSummariesAtSlot).calledWith(0).thenReturn([]);
    const {data: blockHeaders} = (await api.getBlockHeaders({slot: 0})) as {data: routes.beacon.BlockHeaderResponse[]};
    expect(blockHeaders.length).toBe(1);
    expect(blockHeaders[0].canonical).toBe(true);
  });

  it("skip slot", async () => {
    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 2}));
    when(modules.chain.getCanonicalBlockAtSlot).calledWith(0).thenResolve(null);
    const {data: blockHeaders} = await api.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).toBe(0);
  });

  it.skip("parent root filter - both finalized and non finalized results", async () => {
    modules.db.blockArchive.getByParentRoot.mockResolvedValue(ssz.phase0.SignedBeaconBlock.defaultValue());
    modules.forkChoice.getBlockSummariesByParentRoot.mockReturnValue([
      generateProtoBlock({slot: 2}),
      generateProtoBlock({slot: 1}),
    ]);
    const canonical = generateSignedBlockAtSlot(2);
    when(modules.forkChoice.getCanonicalBlockAtSlot).calledWith(1).thenReturn(generateProtoBlock());
    when(modules.forkChoice.getCanonicalBlockAtSlot)
      .calledWith(2)
      .thenReturn(generateProtoBlock({blockRoot: toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(canonical.message))}));
    modules.db.block.get.mockResolvedValue(generateSignedBlockAtSlot(1));
    modules.db.block.get.mockResolvedValue(generateSignedBlockAtSlot(2));
    const {data: blockHeaders} = (await api.getBlockHeaders({parentRoot})) as {
      data: routes.beacon.BlockHeaderResponse[];
    };
    expect(blockHeaders.length).toBe(3);
    expect(blockHeaders.filter((b) => b.canonical).length).toBe(2);
  });

  it("parent root - no finalized block", async () => {
    modules.db.blockArchive.getByParentRoot.mockResolvedValue(null);
    modules.forkChoice.getBlockSummariesByParentRoot.mockReturnValue([generateProtoBlock({slot: 1})]);
    when(modules.forkChoice.getCanonicalBlockAtSlot).calledWith(1).thenReturn(generateProtoBlock());
    modules.db.block.get.mockResolvedValue(generateSignedBlockAtSlot(1));
    const {data: blockHeaders} = await api.getBlockHeaders({parentRoot});

    expect(blockHeaders.length).toBe(1);
  });

  it("parent root - no non finalized blocks", async () => {
    modules.db.blockArchive.getByParentRoot.mockResolvedValue(ssz.phase0.SignedBeaconBlock.defaultValue());
    modules.forkChoice.getBlockSummariesByParentRoot.mockReturnValue([]);
    const {data: blockHeaders} = await api.getBlockHeaders({parentRoot});
    expect(blockHeaders.length).toBe(1);
  });

  it("parent root + slot filter", async () => {
    modules.db.blockArchive.getByParentRoot.mockResolvedValue(ssz.phase0.SignedBeaconBlock.defaultValue());
    modules.forkChoice.getBlockSummariesByParentRoot.mockReturnValue([
      generateProtoBlock({slot: 2}),
      generateProtoBlock({slot: 1}),
    ]);
    const canonical = generateSignedBlockAtSlot(2);
    when(modules.forkChoice.getCanonicalBlockAtSlot).calledWith(1).thenReturn(generateProtoBlock());
    when(modules.forkChoice.getCanonicalBlockAtSlot)
      .calledWith(2)
      .thenReturn(generateProtoBlock({blockRoot: toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(canonical.message))}));
    modules.db.block.get.mockResolvedValueOnce(generateSignedBlockAtSlot(1));
    modules.db.block.get.mockResolvedValueOnce(generateSignedBlockAtSlot(2));
    const {data: blockHeaders} = await api.getBlockHeaders({
      parentRoot: toHexString(Buffer.alloc(32, 1)),
      slot: 1,
    });
    expect(blockHeaders).toHaveLength(1);
  });
});
