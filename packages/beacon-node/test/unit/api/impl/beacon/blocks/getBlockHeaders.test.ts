import {toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, vi, afterEach} from "vitest";
import {when} from "vitest-when";
import {ssz} from "@lodestar/types";
import {generateProtoBlock, generateSignedBlockAtSlot} from "../../../../../utils/typeGenerator.js";
import {setupApiImplTestServer, ApiImplTestModules} from "../../../../../__mocks__/apiMocks.js";

describe("api - beacon - getBlockHeaders", function () {
  let server: ApiImplTestModules;
  const parentRoot = toHexString(Buffer.alloc(32, 1));

  beforeEach(function () {
    server = setupApiImplTestServer();
    server.chainStub.forkChoice = server.forkChoiceStub;

    vi.spyOn(server.dbStub.block, "get");
    vi.spyOn(server.dbStub.blockArchive, "getByParentRoot");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // eslint-disable-next-line vitest/no-disabled-tests
  it.skip("no filters - assume head slot", async function () {
    server.forkChoiceStub.getHead.mockReturnValue(generateProtoBlock({slot: 1}));
    when(server.chainStub.getCanonicalBlockAtSlot)
      .calledWith(1)
      .thenResolve({block: ssz.phase0.SignedBeaconBlock.defaultValue(), executionOptimistic: false});
    when(server.forkChoiceStub.getBlockSummariesAtSlot)
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
    server.dbStub.block.get.mockResolvedValue(blockFromDb3);

    server.dbStub.blockArchive.get.mockResolvedValue(null);
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({});
    expect(blockHeaders).not.toBeNull();
    expect(blockHeaders.length).toBe(2);
    expect(blockHeaders.filter((header) => header.canonical).length).toBe(1);
    expect(server.forkChoiceStub.getHead).toHaveBeenCalledTimes(1);
    expect(server.chainStub.getCanonicalBlockAtSlot).toHaveBeenCalledTimes(1);
    expect(server.forkChoiceStub.getBlockSummariesAtSlot).toHaveBeenCalledTimes(1);
    expect(server.dbStub.block.get).toHaveBeenCalledTimes(1);
  });

  it("future slot", async function () {
    server.forkChoiceStub.getHead.mockReturnValue(generateProtoBlock({slot: 1}));
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({slot: 2});
    expect(blockHeaders.length).toBe(0);
  });

  it("finalized slot", async function () {
    server.forkChoiceStub.getHead.mockReturnValue(generateProtoBlock({slot: 2}));
    when(server.chainStub.getCanonicalBlockAtSlot)
      .calledWith(0)
      .thenResolve({block: ssz.phase0.SignedBeaconBlock.defaultValue(), executionOptimistic: false});
    when(server.forkChoiceStub.getBlockSummariesAtSlot).calledWith(0).thenReturn([]);
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).toBe(1);
    expect(blockHeaders[0].canonical).toBe(true);
  });

  it("skip slot", async function () {
    server.forkChoiceStub.getHead.mockReturnValue(generateProtoBlock({slot: 2}));
    when(server.chainStub.getCanonicalBlockAtSlot).calledWith(0).thenResolve(null);
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({slot: 0});
    expect(blockHeaders.length).toBe(0);
  });

  // eslint-disable-next-line vitest/no-disabled-tests
  it.skip("parent root filter - both finalized and non finalized results", async function () {
    server.dbStub.blockArchive.getByParentRoot.mockResolvedValue(ssz.phase0.SignedBeaconBlock.defaultValue());
    server.forkChoiceStub.getBlockSummariesByParentRoot.mockReturnValue([
      generateProtoBlock({slot: 2}),
      generateProtoBlock({slot: 1}),
    ]);
    const canonical = generateSignedBlockAtSlot(2);
    when(server.forkChoiceStub.getCanonicalBlockAtSlot).calledWith(1).thenReturn(generateProtoBlock());
    when(server.forkChoiceStub.getCanonicalBlockAtSlot)
      .calledWith(2)
      .thenReturn(generateProtoBlock({blockRoot: toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(canonical.message))}));
    server.dbStub.block.get.mockResolvedValue(generateSignedBlockAtSlot(1));
    server.dbStub.block.get.mockResolvedValue(generateSignedBlockAtSlot(2));
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({parentRoot});
    expect(blockHeaders.length).toBe(3);
    expect(blockHeaders.filter((b) => b.canonical).length).toBe(2);
  });

  it("parent root - no finalized block", async function () {
    server.dbStub.blockArchive.getByParentRoot.mockResolvedValue(null);
    server.forkChoiceStub.getBlockSummariesByParentRoot.mockReturnValue([generateProtoBlock({slot: 1})]);
    when(server.forkChoiceStub.getCanonicalBlockAtSlot).calledWith(1).thenReturn(generateProtoBlock());
    server.dbStub.block.get.mockResolvedValue(generateSignedBlockAtSlot(1));
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({parentRoot});

    expect(blockHeaders.length).toBe(1);
  });

  it("parent root - no non finalized blocks", async function () {
    server.dbStub.blockArchive.getByParentRoot.mockResolvedValue(ssz.phase0.SignedBeaconBlock.defaultValue());
    server.forkChoiceStub.getBlockSummariesByParentRoot.mockReturnValue([]);
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({parentRoot});
    expect(blockHeaders.length).toBe(1);
  });

  it("parent root + slot filter", async function () {
    server.dbStub.blockArchive.getByParentRoot.mockResolvedValue(ssz.phase0.SignedBeaconBlock.defaultValue());
    server.forkChoiceStub.getBlockSummariesByParentRoot.mockReturnValue([
      generateProtoBlock({slot: 2}),
      generateProtoBlock({slot: 1}),
    ]);
    const canonical = generateSignedBlockAtSlot(2);
    when(server.forkChoiceStub.getCanonicalBlockAtSlot).calledWith(1).thenReturn(generateProtoBlock());
    when(server.forkChoiceStub.getCanonicalBlockAtSlot)
      .calledWith(2)
      .thenReturn(generateProtoBlock({blockRoot: toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(canonical.message))}));
    server.dbStub.block.get.mockResolvedValueOnce(generateSignedBlockAtSlot(1));
    server.dbStub.block.get.mockResolvedValueOnce(generateSignedBlockAtSlot(2));
    const {data: blockHeaders} = await server.blockApi.getBlockHeaders({
      parentRoot: toHexString(Buffer.alloc(32, 1)),
      slot: 1,
    });
    expect(blockHeaders).toHaveLength(1);
  });
});
