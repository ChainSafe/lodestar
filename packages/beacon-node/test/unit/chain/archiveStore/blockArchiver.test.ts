import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
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
        payloadStatus: PayloadStatus.FULL,
      })
    );
    const canonicalBlocks = [blocks[4], blocks[3], blocks[1], blocks[0]];
    const nonCanonicalBlocks = [blocks[2]];

    const currentEpoch = 2;

    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors: canonicalBlocks,
      nonAncestors: nonCanonicalBlocks,
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

  it("tolerates already-archived boundary block and still migrates its data columns", async () => {
    // Setup: fork-choice returns the full walk including the previous finalized block as the last
    // ancestor (slot 2). Its SignedBeaconBlock was archived on the previous run so `db.block.getBinary`
    // returns null for it. The block migrator must skip rather than throw, while the data-column
    // migrator still ships columns for that boundary block.
    const config = createChainForkConfig({
      ...defaultConfig,
      FULU_FORK_EPOCH: 0,
      MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 4,
    });

    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const blockBytes = ssz.fulu.SignedBeaconBlock.serialize(block);
    const dataColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    const dataColumnBytes = ssz.fulu.DataColumnSidecar.serialize(dataColumn);

    const newAncestor = generateProtoBlock({
      slot: 4,
      blockRoot: toHexString(Buffer.alloc(32, 4)),
      payloadStatus: PayloadStatus.FULL,
    });
    const boundary = generateProtoBlock({
      slot: 2,
      blockRoot: toHexString(Buffer.alloc(32, 2)),
      payloadStatus: PayloadStatus.FULL,
    });

    // Only the new ancestor is in hot db; boundary already migrated last run.
    vi.spyOn(dbStub.block, "getBinary").mockImplementation(async (root: Uint8Array) => {
      return toHexString(root) === newAncestor.blockRoot ? Buffer.from(blockBytes) : null;
    });
    vi.spyOn(dbStub.dataColumnSidecar, "valuesStreamBinary").mockReturnValue(
      toAsyncIterable([{id: dataColumn.index, prefix: block.message.stateRoot, value: dataColumnBytes}])
    );
    vi.spyOn(dbStub.dataColumnSidecarArchive, "keys").mockResolvedValue([]);

    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors: [newAncestor, boundary],
      nonAncestors: [],
    });

    await archiveBlocks(
      config,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {epoch: 1, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
      1
    );

    // Block migration writes only the new ancestor (boundary skipped because its hot-db entry is null)
    expect(dbStub.blockArchive.batchPutBinary).toHaveBeenCalledTimes(1);
    const batchedBlocks = (dbStub.blockArchive.batchPutBinary as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(batchedBlocks).toHaveLength(1);
    expect(batchedBlocks[0].slot).toBe(4);
    expect(dbStub.block.batchDelete).toHaveBeenCalledWith([fromHexString(newAncestor.blockRoot)]);

    // Data-column migration runs for BOTH ancestors — boundary still needs its columns shipped.
    expect(dbStub.dataColumnSidecarArchive.putManyBinary).toHaveBeenCalledWith(4, [{key: 0, value: dataColumnBytes}]);
    expect(dbStub.dataColumnSidecarArchive.putManyBinary).toHaveBeenCalledWith(2, [{key: 0, value: dataColumnBytes}]);
    expect(dbStub.dataColumnSidecar.deleteMany).toHaveBeenCalledWith([
      fromHexString(newAncestor.blockRoot),
      fromHexString(boundary.blockRoot),
    ]);
  });

  it("is a no-op when ancestors and non-ancestors are empty", async () => {
    const config = createChainForkConfig({
      ...defaultConfig,
      FULU_FORK_EPOCH: 0,
      MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 4,
    });

    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors: [],
      nonAncestors: [],
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
