import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {archiveBlocks} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {MockedBeaconDb, getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

function toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const it of items) yield it;
    },
  };
}

describe("block archiver task", () => {
  const logger = testLogger();

  let dbStub: MockedBeaconDb;
  let forkChoiceStub: MockedBeaconChain["forkChoice"];
  let lightclientServer: MockedBeaconChain["lightClientServer"];

  beforeEach(() => {
    const chain = getMockedBeaconChain();
    dbStub = getMockedBeaconDb();
    forkChoiceStub = chain.forkChoice;
    lightclientServer = chain.lightClientServer;

    vi.spyOn(dbStub.blockArchive, "batchPutBinary");
    vi.spyOn(dbStub.block, "batchDelete");
    vi.spyOn(dbStub.blobSidecarsArchive, "batchPutBinary");
    vi.spyOn(dbStub.blobSidecars, "batchDelete");
    vi.spyOn(dbStub.dataColumnSidecarArchive, "putManyBinary");
    vi.spyOn(dbStub.dataColumnSidecar, "deleteMany");
    // Mock keys() to return empty array by default
    vi.spyOn(dbStub.blobSidecarsArchive, "keys").mockResolvedValue([]);
    // vi.spyOn(dbStub.dataColumnSidecarArchive, "keys").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should archive finalized blocks", async () => {
    const config = defaultConfig;
    const blockBytes = ssz.phase0.SignedBeaconBlock.serialize(ssz.phase0.SignedBeaconBlock.defaultValue());
    vi.spyOn(dbStub.block, "getBinary").mockResolvedValue(Buffer.from(blockBytes));
    // block i has slot i+1
    const blocks = Array.from({length: 5}, (_, i) =>
      generateProtoBlock({slot: i + 1, blockRoot: toHexString(Buffer.alloc(32, i + 1))})
    );
    const canonicalBlocks = [blocks[4], blocks[3], blocks[1], blocks[0]];
    const nonCanonicalBlocks = [blocks[2]];
    const currentEpoch = 8;
    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors: canonicalBlocks,
      nonAncestors: nonCanonicalBlocks,
      previousFinalizedFull: undefined,
    });
    await archiveBlocks(
      config,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {epoch: 5, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
      currentEpoch
    );

    const expectedData = canonicalBlocks
      .map((summary) => ({
        key: summary.slot,
        value: blockBytes,
        slot: summary.slot,
        blockRoot: fromHexString(summary.blockRoot),
        parentRoot: fromHexString(summary.parentRoot),
      }))
      .map((data) => ({
        ...data,
        value: Buffer.from(data.value),
        parentRoot: Buffer.from(data.parentRoot),
      }));

    expect(dbStub.blockArchive.batchPutBinary).toHaveBeenNthCalledWith(1, expectedData);

    // delete canonical blocks
    expect(dbStub.block.batchDelete).toBeCalledWith(
      [blocks[4], blocks[3], blocks[1], blocks[0]].map((summary) => fromHexString(summary.blockRoot))
    );
    // delete non canonical blocks
    expect(dbStub.block.batchDelete).toBeCalledWith([blocks[2]].map((summary) => fromHexString(summary.blockRoot)));
  });

  it("should archive data column sidecars for finalized blocks", async () => {
    const config = createChainForkConfig({
      ...defaultConfig,
      FULU_FORK_EPOCH: 0,
      MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 2,
    });

    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const blockBytes = ssz.fulu.SignedBeaconBlock.serialize(block);

    const dataColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    const dataColumnBytes = ssz.fulu.DataColumnSidecar.serialize(dataColumn);

    vi.spyOn(dbStub.block, "getBinary").mockResolvedValue(blockBytes);
    vi.spyOn(dbStub.dataColumnSidecar, "valuesStreamBinary").mockReturnValue(
      toAsyncIterable([{id: dataColumn.index, prefix: block.message.stateRoot, value: dataColumnBytes}])
    );

    // Create blocks after fulu fork
    const blocks = Array.from({length: 5}, (_, i) =>
      generateProtoBlock({
        slot: i + 1 + config.FULU_FORK_EPOCH * 32,
        blockRoot: toHexString(Buffer.alloc(32, i + 1)),
      })
    );
    const canonicalBlocks = [blocks[4], blocks[3], blocks[1], blocks[0]];
    const nonCanonicalBlocks = [blocks[2]];

    const currentEpoch = 2;

    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors: canonicalBlocks,
      nonAncestors: nonCanonicalBlocks,
      previousFinalizedFull: undefined,
    });

    vi.spyOn(dbStub.dataColumnSidecarArchive, "keys").mockResolvedValue(
      nonCanonicalBlocks.map((block) => ({prefix: block.slot, id: 0}))
    );

    await archiveBlocks(
      config,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {
        epoch: config.FULU_FORK_EPOCH + 1,
        root: fromHexString(ZERO_HASH_HEX),
        rootHex: ZERO_HASH_HEX,
      },
      currentEpoch
    );

    // Verify data column sidecars are archived
    for (const block of canonicalBlocks) {
      expect(dbStub.dataColumnSidecarArchive.putManyBinary).toHaveBeenCalledWith(block.slot, [
        {
          key: 0,
          value: dataColumnBytes,
        },
      ]);
    }

    // Verify canonical data column sidecars are deleted from hot storage
    expect(dbStub.dataColumnSidecar.deleteMany).toBeCalledWith(
      canonicalBlocks.map((block) => fromHexString(block.blockRoot))
    );

    // Verify non-canonical data column sidecars are deleted
    expect(dbStub.dataColumnSidecar.deleteMany).toBeCalledWith(
      nonCanonicalBlocks.map((block) => fromHexString(block.blockRoot))
    );

    expect(dbStub.dataColumnSidecarArchive.keys).toBeCalledWith({
      lt: {prefix: computeStartSlotAtEpoch(currentEpoch - config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS), id: 0},
    });
  });

  it("migrates data columns of previousFinalizedFull without re-archiving its block", async () => {
    // Setup: the previous finalized block (slot 2) had its CL part archived on the prior run but
    // its data columns were still in hot DB. Now that its FULL variant is present, archiveBlocks
    // ships the columns. The block itself is not re-written to the archive.
    const config = createChainForkConfig({
      ...defaultConfig,
      FULU_FORK_EPOCH: 0,
      MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 4,
    });

    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const blockBytes = ssz.fulu.SignedBeaconBlock.serialize(block);
    const dataColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    const dataColumnBytes = ssz.fulu.DataColumnSidecar.serialize(dataColumn);

    vi.spyOn(dbStub.block, "getBinary").mockResolvedValue(blockBytes);
    vi.spyOn(dbStub.dataColumnSidecar, "valuesStreamBinary").mockReturnValue(
      toAsyncIterable([{id: dataColumn.index, prefix: block.message.stateRoot, value: dataColumnBytes}])
    );
    vi.spyOn(dbStub.dataColumnSidecarArchive, "keys").mockResolvedValue([]);

    const ancestors = [generateProtoBlock({slot: 4, blockRoot: toHexString(Buffer.alloc(32, 4))})];
    const previousFinalizedFull = generateProtoBlock({slot: 2, blockRoot: toHexString(Buffer.alloc(32, 2))});
    const currentEpoch = 1;

    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors,
      nonAncestors: [],
      previousFinalizedFull,
    });

    await archiveBlocks(
      config,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {epoch: 1, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
      currentEpoch
    );

    // Block migration runs ONLY for the new ancestor range — previousFinalizedFull's CL part
    // already shipped last run.
    expect(dbStub.blockArchive.batchPutBinary).toHaveBeenCalledTimes(1);
    const batchedBlocks = (dbStub.blockArchive.batchPutBinary as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(batchedBlocks).toHaveLength(1);
    expect(batchedBlocks[0].slot).toBe(4);

    // Data-column migration runs for BOTH the new ancestor AND the previousFinalizedFull block.
    expect(dbStub.dataColumnSidecarArchive.putManyBinary).toHaveBeenCalledWith(4, [{key: 0, value: dataColumnBytes}]);
    expect(dbStub.dataColumnSidecarArchive.putManyBinary).toHaveBeenCalledWith(2, [{key: 0, value: dataColumnBytes}]);

    // Both roots deleted from hot DB to avoid orphans.
    expect(dbStub.dataColumnSidecar.deleteMany).toHaveBeenCalledWith([
      fromHexString(ancestors[0].blockRoot),
      fromHexString(previousFinalizedFull.blockRoot),
    ]);
  });

  it("is a no-op when previousFinalizedFull is undefined and ancestors is empty", async () => {
    // Guard: when the previous finalized block's FULL variant is not yet available and there are
    // no new ancestors to ship, archiveBlocks should make no writes and no deletes.
    const config = createChainForkConfig({
      ...defaultConfig,
      FULU_FORK_EPOCH: 0,
      MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 4,
    });

    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors: [],
      nonAncestors: [],
      previousFinalizedFull: undefined,
    });
    vi.spyOn(dbStub.dataColumnSidecarArchive, "keys").mockResolvedValue([]);

    await archiveBlocks(
      config,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {epoch: 1, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
      1
    );

    expect(dbStub.blockArchive.batchPutBinary).not.toHaveBeenCalled();
    expect(dbStub.dataColumnSidecarArchive.putManyBinary).not.toHaveBeenCalled();
  });
});
