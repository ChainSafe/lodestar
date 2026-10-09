import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {LogLevel} from "@lodestar/utils";
import {LateCanonicalBlockReason, archiveBlocks} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import type {Metrics} from "../../../../src/metrics/metrics.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {MockedBeaconDb, getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

function toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
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
    vi.spyOn(dbStub.dataColumnSidecarArchive, "putManyBinary");
    vi.spyOn(dbStub.dataColumnSidecar, "deleteMany");
    vi.spyOn(dbStub.blobSidecarsArchive, "keys").mockResolvedValue([]);
    vi.spyOn(dbStub.dataColumnSidecarArchive, "keys").mockResolvedValue([]);
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
      generateProtoBlock({
        slot: i + 1,
        blockRoot: toHexString(Buffer.alloc(32, i + 1)),
        payloadStatus: PayloadStatus.FULL,
      })
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
      currentEpoch,
      null,
      false
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
    expect(dbStub.dataColumns.deleteMany).not.toHaveBeenCalled();
  });

  it("should archive legacy data column sidecars for finalized blocks", async () => {
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

    const blocks = Array.from({length: 5}, (_, i) =>
      generateProtoBlock({
        slot: i + 1,
        blockRoot: toHexString(Buffer.alloc(32, i + 1)),
        payloadStatus: PayloadStatus.FULL,
      })
    );
    const canonicalBlocks = [blocks[4], blocks[3], blocks[1], blocks[0]];
    const nonCanonicalBlocks = [blocks[2]];
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
      {epoch: 1, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
      2,
      null,
      false
    );

    for (const canonicalBlock of canonicalBlocks) {
      expect(dbStub.dataColumnSidecarArchive.putManyBinary).toHaveBeenCalledWith(canonicalBlock.slot, [
        {key: dataColumn.index, value: dataColumnBytes},
      ]);
    }
    expect(dbStub.dataColumnSidecar.deleteMany).toHaveBeenCalledWith(
      canonicalBlocks.map((canonicalBlock) => fromHexString(canonicalBlock.blockRoot))
    );
    expect(dbStub.dataColumns.deleteMany).toHaveBeenCalledWith(
      nonCanonicalBlocks.map((nonCanonicalBlock) => ({
        slot: nonCanonicalBlock.slot,
        blockRoot: nonCanonicalBlock.blockRoot,
      }))
    );
  });

  it("should retry legacy columns for an already archived boundary block", async () => {
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

    vi.spyOn(dbStub.block, "getBinary").mockImplementation(async (root: Uint8Array) =>
      toHexString(root) === newAncestor.blockRoot ? Buffer.from(blockBytes) : null
    );
    vi.spyOn(dbStub.dataColumnSidecar, "valuesStreamBinary").mockReturnValue(
      toAsyncIterable([{id: dataColumn.index, prefix: block.message.stateRoot, value: dataColumnBytes}])
    );
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
      1,
      null,
      false
    );

    expect(dbStub.blockArchive.batchPutBinary).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dbStub.blockArchive.batchPutBinary).mock.calls[0][0]).toHaveLength(1);
    expect(vi.mocked(dbStub.blockArchive.batchPutBinary).mock.calls[0][0][0].slot).toBe(newAncestor.slot);
    expect(dbStub.dataColumnSidecarArchive.putManyBinary).toHaveBeenCalledWith(newAncestor.slot, [
      {key: dataColumn.index, value: dataColumnBytes},
    ]);
    expect(dbStub.dataColumnSidecarArchive.putManyBinary).toHaveBeenCalledWith(boundary.slot, [
      {key: dataColumn.index, value: dataColumnBytes},
    ]);
    expect(dbStub.dataColumnSidecar.deleteMany).toHaveBeenCalledWith([
      fromHexString(newAncestor.blockRoot),
      fromHexString(boundary.blockRoot),
    ]);
  });

  it("does not treat sibling payload variants of canonical blocks as non-canonical", async () => {
    // Post-gloas a block has three fork choice nodes (PENDING/EMPTY/FULL) sharing one blockRoot. Fork choice drops
    // PENDING from nonAncestors, and only one of EMPTY/FULL is on the ancestor walk, so the other sibling shows up in
    // nonAncestors. Block-level data (block, light client witness/header) must not be pruned for it, while
    // payload-level data (sidecars) of the losing variant must still be pruned.
    const config = createChainForkConfig({
      ...defaultConfig,
      FULU_FORK_EPOCH: 0,
      MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 2,
    });
    const blockBytes = ssz.fulu.SignedBeaconBlock.serialize(ssz.fulu.SignedBeaconBlock.defaultValue());
    vi.spyOn(dbStub.block, "getBinary").mockResolvedValue(blockBytes);
    vi.spyOn(dbStub.dataColumnSidecar, "valuesStreamBinary").mockReturnValue(toAsyncIterable([]));
    vi.spyOn(dbStub.dataColumnSidecarArchive, "keys").mockResolvedValue([]);
    const pruneSpy = vi.spyOn(lightclientServer, "pruneNonCheckpointData").mockResolvedValue(undefined);

    const root = (i: number): string => toHexString(Buffer.alloc(32, i));
    // The finalized checkpoint at slot 64 builds on the EMPTY variant at slot 32 after skipped slots.
    // This finalizes the EMPTY payload choice while slot 32 remains a checkpoint block.
    const finalizedPending = generateProtoBlock({
      slot: 64,
      blockRoot: root(4),
      parentRoot: root(1),
      payloadStatus: PayloadStatus.PENDING,
    });
    const boundaryEmpty = generateProtoBlock({
      slot: 32,
      blockRoot: root(1),
      parentRoot: root(2),
      payloadStatus: PayloadStatus.EMPTY,
    });
    const boundaryFull = generateProtoBlock({
      slot: 32,
      blockRoot: root(1),
      parentRoot: root(2),
      payloadStatus: PayloadStatus.FULL,
    });
    const parentFull = generateProtoBlock({slot: 31, blockRoot: root(2), payloadStatus: PayloadStatus.FULL});
    const parentEmpty = generateProtoBlock({slot: 31, blockRoot: root(2), payloadStatus: PayloadStatus.EMPTY});
    const orphan = generateProtoBlock({slot: 30, blockRoot: root(3), payloadStatus: PayloadStatus.FULL});
    const canonicalBlocks = [finalizedPending, boundaryEmpty, parentFull];
    const nonCanonicalBlocks = [boundaryFull, parentEmpty, orphan];

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
      {epoch: 2, root: fromHexString(finalizedPending.blockRoot), rootHex: finalizedPending.blockRoot},
      3,
      null,
      false
    );

    // Block-level: delete only the orphan as non-canonical
    expect(dbStub.block.batchDelete).toBeCalledWith([fromHexString(root(3))]);
    for (const [i, [roots]] of vi.mocked(dbStub.block.batchDelete).mock.calls.entries()) {
      const hexes = roots.map((r) => toHexString(r));
      if (hexes.includes(root(3))) {
        expect(hexes, `block.batchDelete call ${i} deletes more than the orphan`).toEqual([root(3)]);
      }
    }

    // Payload-level: the losing FULL payload of the EMPTY-finalized block and the orphan are pruned
    expect(dbStub.dataColumns.deleteMany).toHaveBeenCalledWith([
      {slot: boundaryFull.slot, blockRoot: boundaryFull.blockRoot},
      {slot: orphan.slot, blockRoot: orphan.blockRoot},
    ]);

    // Keep light client data of canonical blocks, prune the orphan and the canonical non-checkpoint block
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    const pruned = pruneSpy.mock.calls[0][0].map((r) => toHexString(r));
    expect(pruned).toContain(root(3)); // orphan
    expect(pruned).toContain(root(2)); // canonical but not an epoch boundary block
    expect(pruned).not.toContain(root(1)); // canonical epoch boundary block
  });

  it("should delete sidecars only for non-canonical FULL payload variants", async () => {
    const config = createChainForkConfig({
      ...defaultConfig,
      DENEB_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
    });
    const fullRoot = toHexString(Buffer.alloc(32, 1));
    const emptyRoot = toHexString(Buffer.alloc(32, 2));
    const canonicalFull = generateProtoBlock({slot: 3, blockRoot: fullRoot, payloadStatus: PayloadStatus.FULL});
    const nonCanonicalEmpty = generateProtoBlock({slot: 3, blockRoot: fullRoot, payloadStatus: PayloadStatus.EMPTY});
    const canonicalEmpty = generateProtoBlock({slot: 4, blockRoot: emptyRoot, payloadStatus: PayloadStatus.EMPTY});
    const nonCanonicalFull = generateProtoBlock({slot: 4, blockRoot: emptyRoot, payloadStatus: PayloadStatus.FULL});
    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors: [canonicalFull, canonicalEmpty],
      nonAncestors: [nonCanonicalEmpty, nonCanonicalFull],
    });

    await archiveBlocks(
      config,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {epoch: 5, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
      8,
      null,
      false
    );

    expect(dbStub.dataColumns.deleteMany).toHaveBeenCalledWith([
      {slot: nonCanonicalFull.slot, blockRoot: nonCanonicalFull.blockRoot},
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
    await archiveBlocks(
      config,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {epoch: 1, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
      1,
      null,
      false
    );

    expect(dbStub.blockArchive.batchPutBinary).not.toHaveBeenCalled();
  });

  it("should retain non-canonical blocks when flat file cleanup fails", async () => {
    const config = createChainForkConfig({...defaultConfig, FULU_FORK_EPOCH: 0});
    const block = generateProtoBlock({
      slot: 3,
      blockRoot: toHexString(Buffer.alloc(32, 3)),
      payloadStatus: PayloadStatus.FULL,
    });
    vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
      ancestors: [],
      nonAncestors: [block],
    });
    const deleteError = new Error("flat file cleanup failed");
    vi.mocked(dbStub.dataColumns.deleteMany).mockRejectedValueOnce(deleteError);

    await expect(
      archiveBlocks(
        config,
        dbStub,
        forkChoiceStub,
        lightclientServer,
        logger,
        {epoch: 5, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
        8,
        null,
        false
      )
    ).rejects.toBe(deleteError);

    expect(dbStub.dataColumns.deleteMany).toHaveBeenCalledWith([{slot: block.slot, blockRoot: block.blockRoot}]);
    expect(dbStub.block.batchDelete).not.toHaveBeenCalled();
  });

  it.each([{prunedSlots: []}, {prunedSlots: [96, 98, 99]}])(
    "should report pruned column slots $prunedSlots for the retained window",
    async ({prunedSlots}) => {
      const config = createChainForkConfig({
        ...defaultConfig,
        DENEB_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 2,
      });

      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      const blockBytes = ssz.fulu.SignedBeaconBlock.serialize(block);
      vi.spyOn(dbStub.block, "getBinary").mockResolvedValue(blockBytes);

      const blocks = Array.from({length: 3}, (_, i) =>
        generateProtoBlock({
          slot: 100 + i,
          blockRoot: toHexString(Buffer.alloc(32, i + 1)),
          payloadStatus: PayloadStatus.FULL,
        })
      );
      const canonicalBlocks = [blocks[2], blocks[1], blocks[0]];

      vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
        ancestors: canonicalBlocks,
        nonAncestors: [],
      });

      const currentEpoch = 10;
      const verbose = vi.spyOn(logger, LogLevel.verbose);
      vi.mocked(dbStub.dataColumns.pruneBefore).mockResolvedValue(prunedSlots);
      await archiveBlocks(
        config,
        dbStub,
        forkChoiceStub,
        lightclientServer,
        logger,
        {
          epoch: currentEpoch,
          root: fromHexString(ZERO_HASH_HEX),
          rootHex: ZERO_HASH_HEX,
        },
        currentEpoch,
        null,
        false
      );

      const columnsPruneSlot = computeStartSlotAtEpoch(
        currentEpoch - config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS
      );
      expect(dbStub.dataColumns.pruneBefore).toHaveBeenCalledWith(columnsPruneSlot);
      if (prunedSlots.length > 0) {
        expect(verbose).toHaveBeenCalledWith(
          "dataColumnSidecars prune",
          expect.objectContaining({slotRange: "[96, 98-99]", numOfSlots: 3})
        );
      } else {
        expect(verbose).toHaveBeenCalledWith(
          "dataColumnSidecars prune: no entries before slot",
          expect.objectContaining({slot: columnsPruneSlot})
        );
      }
    }
  );

  describe("audit late-imported-but-canonical blocks", () => {
    // newest -> oldest; last element is the previous-finalized boundary (excluded). Late =
    // importedTimely === false. Invariant: timeliness === false implies importedTimely === false.
    //   slot 10: late import, received late     => late_receive
    //   slot  9: imported on time               => not late
    //   slot  8: late import, received on time   => slow_import
    //   slot  7: boundary, excluded
    function getCanonicalBlocksWithLateImports() {
      return [
        generateProtoBlock({
          slot: 10,
          blockRoot: toHexString(Buffer.alloc(32, 10)),
          importedTimely: false,
          timeliness: false,
        }),
        generateProtoBlock({
          slot: 9,
          blockRoot: toHexString(Buffer.alloc(32, 9)),
          importedTimely: true,
          timeliness: true,
        }),
        generateProtoBlock({
          slot: 8,
          blockRoot: toHexString(Buffer.alloc(32, 8)),
          importedTimely: false,
          timeliness: true,
        }),
        generateProtoBlock({
          slot: 7,
          blockRoot: toHexString(Buffer.alloc(32, 7)),
          importedTimely: false,
          timeliness: false,
        }),
      ];
    }

    function getMetricsWithIncSpy() {
      const inc = vi.fn();
      const metrics = {importBlock: {lateCanonicalBlock: {inc}}} as unknown as Metrics;
      return {metrics, inc};
    }

    it("counts non-boundary late-imported canonical blocks by reason when synced", async () => {
      vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
        ancestors: getCanonicalBlocksWithLateImports(),
        nonAncestors: [],
      });
      const {metrics, inc} = getMetricsWithIncSpy();

      await archiveBlocks(
        defaultConfig,
        dbStub,
        forkChoiceStub,
        lightclientServer,
        logger,
        {epoch: 5, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
        8,
        metrics,
        true // isNodeSynced
      );

      // one inc per late non-boundary block: slot 10 (late_receive), slot 8 (slow_import)
      expect(inc).toHaveBeenCalledTimes(2);
      expect(inc).toHaveBeenCalledWith({reason: LateCanonicalBlockReason.LateReceive});
      expect(inc).toHaveBeenCalledWith({reason: LateCanonicalBlockReason.SlowImport});
    });

    it("does not count late-imported blocks when not synced", async () => {
      vi.spyOn(forkChoiceStub, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockReturnValue({
        ancestors: getCanonicalBlocksWithLateImports(),
        nonAncestors: [],
      });
      const {metrics, inc} = getMetricsWithIncSpy();

      await archiveBlocks(
        defaultConfig,
        dbStub,
        forkChoiceStub,
        lightclientServer,
        logger,
        {epoch: 5, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
        8,
        metrics,
        false // isNodeSynced
      );

      expect(inc).not.toHaveBeenCalled();
    });
  });
});
