import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {when} from "vitest-when";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock, generateSignedBlockAtSlot} from "../../../../../utils/typeGenerator.js";

describe("api - beacon - getBlockHeaders", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconBlockApi>;
  const parentRoot = toHexString(Buffer.alloc(32, 1));

  beforeEach(() => {
    modules = getApiTestModules();
    api = getBeaconBlockApi(defaultApiOptions, modules);

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
    modules.chain.getBlockByRoot.mockResolvedValue({
      block: blockFromDb3,
      executionOptimistic: false,
      finalized: false,
    });

    modules.db.blockArchive.get.mockResolvedValue(null);
    const {data: blockHeaders} = (await api.getBlockHeaders({})) as {data: routes.beacon.BlockHeaderResponse[]};
    expect(blockHeaders).not.toBeNull();
    expect(blockHeaders.length).toBe(2);
    expect(blockHeaders.filter((header) => header.canonical).length).toBe(1);
    expect(modules.forkChoice.getHead).toHaveBeenCalledTimes(1);
    expect(modules.chain.getCanonicalBlockAtSlot).toHaveBeenCalledTimes(1);
    expect(modules.forkChoice.getBlockSummariesAtSlot).toHaveBeenCalledTimes(1);
    expect(modules.chain.getBlockByRoot).toHaveBeenCalledTimes(1);
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
    when(modules.forkChoice.getBlockSummariesAtSlot).calledWith(0).thenReturn([]);
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
    modules.chain.getBlockByRoot.mockResolvedValueOnce({
      block: generateSignedBlockAtSlot(1),
      executionOptimistic: false,
      finalized: false,
    });
    modules.chain.getBlockByRoot.mockResolvedValueOnce({
      block: generateSignedBlockAtSlot(2),
      executionOptimistic: false,
      finalized: false,
    });
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
    modules.chain.getBlockByRoot.mockResolvedValue({
      block: generateSignedBlockAtSlot(1),
      executionOptimistic: false,
      finalized: false,
    });
    const {data: blockHeaders} = await api.getBlockHeaders({parentRoot});

    expect(blockHeaders.length).toBe(1);
  });

  it("parent root - no non finalized blocks", async () => {
    modules.db.blockArchive.getByParentRoot.mockResolvedValue(ssz.phase0.SignedBeaconBlock.defaultValue());
    modules.forkChoice.getBlockSummariesByParentRoot.mockReturnValue([]);
    const {data: blockHeaders} = await api.getBlockHeaders({parentRoot});
    expect(blockHeaders.length).toBe(1);
  });

  it("parent root - child at a slot skipped by the canonical chain", async () => {
    // The child at slot 1 was reorged out by its sibling at slot 2, the canonical chain has no block at slot 1
    const orphaned = generateSignedBlockAtSlot(1);
    const canonical = generateSignedBlockAtSlot(2);
    const orphanedRoot = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(orphaned.message));
    const canonicalRoot = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(canonical.message));
    const canonicalSummary = generateProtoBlock({slot: 2, blockRoot: canonicalRoot, parentRoot});

    modules.db.blockArchive.getByParentRoot.mockResolvedValue(null);
    modules.forkChoice.getBlockSummariesByParentRoot.mockReturnValue([
      generateProtoBlock({slot: 1, blockRoot: orphanedRoot, parentRoot}),
      canonicalSummary,
    ]);
    when(modules.forkChoice.getCanonicalBlockAtSlot).calledWith(1).thenReturn(null);
    when(modules.forkChoice.getCanonicalBlockAtSlot).calledWith(2).thenReturn(canonicalSummary);
    when(modules.chain.getBlockByRoot)
      .calledWith(orphanedRoot)
      .thenResolve({block: orphaned, executionOptimistic: false, finalized: false});
    when(modules.chain.getBlockByRoot)
      .calledWith(canonicalRoot)
      .thenResolve({block: canonical, executionOptimistic: false, finalized: false});

    const {data: blockHeaders} = (await api.getBlockHeaders({parentRoot})) as {
      data: routes.beacon.BlockHeaderResponse[];
    };

    expect(blockHeaders.map((h) => [h.header.message.slot, h.canonical]).sort()).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("parent root - finalized block is returned once", async () => {
    // The finalized block is migrated to the archive but stays in fork choice as its anchor
    const finalizedBlock = generateSignedBlockAtSlot(8);
    const finalizedRoot = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(finalizedBlock.message));
    const finalizedSummary = generateProtoBlock({slot: 8, blockRoot: finalizedRoot, parentRoot});

    modules.db.blockArchive.getByParentRoot.mockResolvedValue(finalizedBlock);
    modules.forkChoice.getBlockSummariesByParentRoot.mockReturnValue([finalizedSummary]);
    when(modules.forkChoice.getCanonicalBlockAtSlot).calledWith(8).thenReturn(finalizedSummary);
    modules.chain.getBlockByRoot.mockResolvedValue({
      block: finalizedBlock,
      executionOptimistic: false,
      finalized: true,
    });

    const {data: blockHeaders, meta} = (await api.getBlockHeaders({parentRoot})) as {
      data: routes.beacon.BlockHeaderResponse[];
      meta: {finalized: boolean};
    };

    expect(blockHeaders).toHaveLength(1);
    expect(blockHeaders[0].canonical).toBe(true);
    expect(meta.finalized).toBe(true);
  });

  it("slot skipped by the canonical chain with a non-canonical block", async () => {
    const orphaned = generateSignedBlockAtSlot(1);
    const orphanedRoot = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(orphaned.message));

    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 2}));
    when(modules.chain.getCanonicalBlockAtSlot).calledWith(1).thenResolve(null);
    when(modules.forkChoice.getBlockSummariesAtSlot)
      .calledWith(1)
      .thenReturn([generateProtoBlock({slot: 1, blockRoot: orphanedRoot})]);
    when(modules.chain.getBlockByRoot)
      .calledWith(orphanedRoot)
      .thenResolve({block: orphaned, executionOptimistic: false, finalized: false});

    const {data: blockHeaders} = (await api.getBlockHeaders({slot: 1})) as {data: routes.beacon.BlockHeaderResponse[]};

    expect(blockHeaders).toHaveLength(1);
    expect(blockHeaders[0].canonical).toBe(false);
    expect(blockHeaders[0].header.message.slot).toBe(1);
  });

  it("finalized slot - finalized block is also in fork choice", async () => {
    // The finalized block is migrated to the archive but stays in fork choice as its anchor
    const finalizedBlock = generateSignedBlockAtSlot(8);
    const finalizedRoot = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(finalizedBlock.message));
    const finalizedSummary = generateProtoBlock({slot: 8, blockRoot: finalizedRoot});

    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 10}));
    when(modules.chain.getCanonicalBlockAtSlot)
      .calledWith(8)
      .thenResolve({block: finalizedBlock, executionOptimistic: false, finalized: true});
    when(modules.forkChoice.getBlockSummariesAtSlot).calledWith(8).thenReturn([finalizedSummary]);

    const {data: blockHeaders, meta} = (await api.getBlockHeaders({slot: 8})) as {
      data: routes.beacon.BlockHeaderResponse[];
      meta: {finalized: boolean};
    };

    expect(blockHeaders).toHaveLength(1);
    expect(blockHeaders[0].canonical).toBe(true);
    expect(meta.finalized).toBe(true);
  });

  it("finalized slot - finalized block is not archived yet", async () => {
    const finalizedBlock = generateSignedBlockAtSlot(8);
    const finalizedRoot = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(finalizedBlock.message));
    const finalizedSummary = generateProtoBlock({slot: 8, blockRoot: finalizedRoot});

    modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 10}));
    when(modules.chain.getCanonicalBlockAtSlot).calledWith(8).thenResolve(null);
    when(modules.forkChoice.getBlockSummariesAtSlot).calledWith(8).thenReturn([finalizedSummary]);
    when(modules.forkChoice.getCanonicalBlockAtSlot).calledWith(8).thenReturn(finalizedSummary);
    when(modules.chain.getBlockByRoot)
      .calledWith(finalizedRoot)
      .thenResolve({block: finalizedBlock, executionOptimistic: false, finalized: false});

    const {data: blockHeaders} = (await api.getBlockHeaders({slot: 8})) as {data: routes.beacon.BlockHeaderResponse[]};

    expect(blockHeaders).toHaveLength(1);
    expect(blockHeaders[0].canonical).toBe(true);
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
    modules.chain.getBlockByRoot.mockResolvedValueOnce({
      block: generateSignedBlockAtSlot(1),
      executionOptimistic: false,
      finalized: false,
    });
    modules.chain.getBlockByRoot.mockResolvedValueOnce({
      block: generateSignedBlockAtSlot(2),
      executionOptimistic: false,
      finalized: false,
    });
    const {data: blockHeaders} = await api.getBlockHeaders({
      parentRoot: toHexString(Buffer.alloc(32, 1)),
      slot: 1,
    });
    expect(blockHeaders).toHaveLength(1);
  });
});
