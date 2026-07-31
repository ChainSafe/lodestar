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

  it("should delete sidecars only for non-canonical FULL payload variants", async () => {
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
      defaultConfig,
      dbStub,
      forkChoiceStub,
      lightclientServer,
      logger,
      {epoch: 5, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
      8
    );

    expect(dbStub.flatFileStore.deleteNonCanonical).toHaveBeenCalledWith([
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
      1
    );

    expect(dbStub.blockArchive.batchPutBinary).not.toHaveBeenCalled();
  });

  it("should retain non-canonical blocks when flat file cleanup fails", async () => {
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
    vi.mocked(dbStub.flatFileStore.deleteNonCanonical).mockRejectedValueOnce(deleteError);

    await expect(
      archiveBlocks(
        defaultConfig,
        dbStub,
        forkChoiceStub,
        lightclientServer,
        logger,
        {epoch: 5, root: fromHexString(ZERO_HASH_HEX), rootHex: ZERO_HASH_HEX},
        8
      )
    ).rejects.toBe(deleteError);

    expect(dbStub.flatFileStore.deleteNonCanonical).toHaveBeenCalledWith([
      {slot: block.slot, blockRoot: block.blockRoot},
    ]);
    expect(dbStub.block.batchDelete).not.toHaveBeenCalled();
  });

  it("should prune flat file store blobs and columns by retained sidecar window", async () => {
    const config = createChainForkConfig({
      ...defaultConfig,
      DENEB_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS: 4,
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
      currentEpoch
    );

    const blobsPruneSlot = computeStartSlotAtEpoch(currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS);
    const columnsPruneSlot = computeStartSlotAtEpoch(
      currentEpoch - config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS
    );
    expect(dbStub.flatFileStore.pruneBlobsBeforeSlot).toHaveBeenCalledWith(blobsPruneSlot);
    expect(dbStub.flatFileStore.pruneColumnsBeforeSlot).toHaveBeenCalledWith(columnsPruneSlot);
  });
});
