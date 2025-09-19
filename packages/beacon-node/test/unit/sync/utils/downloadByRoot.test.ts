import {randomBytes} from "node:crypto";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {BlobIndex, ColumnIndex, ssz} from "@lodestar/types";
import {BlobMeta} from "../../../../src/chain/blocks/blockInput/types.js";
import {BlobSidecarValidationError} from "../../../../src/chain/errors/blobSidecarError.js";
import {DataColumnSidecarValidationError} from "../../../../src/chain/errors/dataColumnSidecarError.js";
import {INetwork} from "../../../../src/network/index.js";
import {PeerSyncMeta} from "../../../../src/network/peers/peersData.js";
import {
  DownloadByRootError,
  fetchAndValidateBlobs,
  fetchAndValidateBlock,
  fetchAndValidateColumns,
  fetchBlobsByRoot,
  fetchColumnsByRoot,
} from "../../../../src/sync/utils/downloadByRoot.js";
import {ROOT_SIZE} from "../../../../src/util/sszBytes.js";
import {
  config,
  generateBlock,
  generateBlockWithBlobSidecars,
  generateBlockWithColumnSidecars,
} from "../../../utils/blocksAndData.js";

describe("downloadByRoot.ts", () => {
  const peerIdStr = "1234567890abcdef1234567890abcdef";
  const peerMeta: PeerSyncMeta = {
    peerId: peerIdStr,
    client: "N/A",
    custodyColumns: Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i),
    earliestAvailableSlot: 0,
  };
  let network: INetwork;

  describe("fetchAndValidateBlock", () => {
    let capellaBlock: ReturnType<typeof generateBlock>;
    beforeAll(() => {
      capellaBlock = generateBlock({forkName: ForkName.capella});
    });
    afterAll(() => {
      vi.resetAllMocks();
    });

    it("should successfully fetch and validate block with matching root", async () => {
      network = {
        sendBeaconBlocksByRoot: vi.fn(() => [{data: capellaBlock.block}]),
      } as unknown as INetwork;

      const response = await fetchAndValidateBlock({
        config,
        network,
        peerIdStr,
        blockRoot: capellaBlock.blockRoot,
      });

      expect(response).toBe(capellaBlock.block);
    });

    it("should throw error when no block is returned from network", async () => {
      network = {
        sendBeaconBlocksByRoot: vi.fn(() => []),
      } as unknown as INetwork;

      await expect(
        fetchAndValidateBlock({
          config,
          network,
          peerIdStr,
          blockRoot: capellaBlock.blockRoot,
        })
      ).rejects.toThrow(DownloadByRootError);
    });

    it("should throw error when block root doesn't match requested root", async () => {
      network = {
        sendBeaconBlocksByRoot: vi.fn(() => [{data: capellaBlock.block}]),
      } as unknown as INetwork;

      const invalidRoot = randomBytes(ROOT_SIZE);

      await expect(
        fetchAndValidateBlock({
          config,
          network,
          peerIdStr,
          blockRoot: invalidRoot,
        })
      ).rejects.toThrow(DownloadByRootError);
    });
  });

  describe("fetchAndValidateBlobs", () => {
    const forkName = ForkName.deneb;
    let denebBlockWithBlobs: ReturnType<typeof generateBlockWithBlobSidecars>;
    let missing: BlobIndex[];

    beforeEach(() => {
      denebBlockWithBlobs = generateBlockWithBlobSidecars({forkName, count: 6});
      missing = denebBlockWithBlobs.blobSidecars.map(({index}) => index);
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it("should successfully fetch blobs from network only", async () => {
      const sendBlobSidecarsByRootMock = vi.fn(() => Promise.resolve(denebBlockWithBlobs.blobSidecars));
      network = {
        sendBlobSidecarsByRoot: sendBlobSidecarsByRootMock,
      } as unknown as INetwork;

      const response = await fetchAndValidateBlobs({
        config,
        network,
        forkName,
        peerIdStr,
        blockRoot: denebBlockWithBlobs.blockRoot,
        block: denebBlockWithBlobs.block,
        missing,
      });

      expect(response).toEqual(denebBlockWithBlobs.blobSidecars);
    });

    it("should not error if unable to fetch all blobs from network", async () => {
      const sendBlobSidecarsByRootMock = vi.fn(() =>
        Promise.resolve([
          denebBlockWithBlobs.blobSidecars[1],
          denebBlockWithBlobs.blobSidecars[3],
          denebBlockWithBlobs.blobSidecars[5],
        ])
      );
      network = {
        sendBlobSidecarsByRoot: sendBlobSidecarsByRootMock,
      } as unknown as INetwork;

      const response = await fetchAndValidateBlobs({
        config,
        network,
        forkName,
        peerIdStr,
        blockRoot: denebBlockWithBlobs.blockRoot,
        block: denebBlockWithBlobs.block,
        missing,
      });

      expect(sendBlobSidecarsByRootMock).toHaveBeenCalledExactlyOnceWith(
        peerIdStr,
        missing.map((index) => ({blockRoot: denebBlockWithBlobs.blockRoot, index}))
      );

      const returnedIndices = response.map((b) => b.index);
      expect(returnedIndices).toEqual([1, 3, 5]);
    });

    it.todo("should throw error if no blobs are returned", async () => {
      const sendBlobSidecarsByRootMock = vi.fn(() => Promise.resolve([]));
      network = {
        sendBlobSidecarsByRoot: sendBlobSidecarsByRootMock,
      } as unknown as INetwork;

      const requestedBlockRoot = randomBytes(ROOT_SIZE);

      await expect(
        fetchAndValidateBlobs({
          config,
          network,
          forkName,
          peerIdStr,
          blockRoot: requestedBlockRoot,
          block: denebBlockWithBlobs.block,
          missing,
        })
      ).rejects.toThrow(BlobSidecarValidationError);
    });
  });

  describe("fetchBlobsByRoot", () => {
    let denebBlockWithColumns: ReturnType<typeof generateBlockWithBlobSidecars>;
    let blockRoot: Uint8Array;
    let missing: BlobIndex[];
    let blobMeta: BlobMeta[];
    beforeAll(() => {
      denebBlockWithColumns = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 6});
      blockRoot = denebBlockWithColumns.blockRoot;
      missing = denebBlockWithColumns.blobSidecars.map(({index}) => index);
      blobMeta = missing.map((index) => ({blockRoot, index}) as BlobMeta);
      network = {
        sendBlobSidecarsByRoot: vi.fn(() => denebBlockWithColumns.blobSidecars),
      } as unknown as INetwork;
    });
    afterAll(() => {
      vi.resetAllMocks();
    });

    it("should fetch missing columnSidecars ByRoot from network", async () => {
      const response = await fetchBlobsByRoot({
        network,
        peerIdStr,
        blockRoot,
        missing,
      });
      expect(response).toEqual(denebBlockWithColumns.blobSidecars);
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledOnce();
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledWith(peerIdStr, blobMeta);
    });

    it("should filter out blobs already in possession", async () => {
      await fetchBlobsByRoot({
        network,
        peerIdStr,
        blockRoot,
        missing,
        // biome-ignore lint/style/noNonNullAssertion: its there
        indicesInPossession: [0, denebBlockWithColumns.blobSidecars.at(-1)?.index!],
      });
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledOnce();
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledWith(peerIdStr, blobMeta.slice(1, -1));
    });

    it("should handle empty blob request when all blobs are in possession", async () => {
      const response = await fetchBlobsByRoot({
        network,
        peerIdStr,
        blockRoot,
        missing,
        indicesInPossession: blobMeta.map(({index}) => index),
      });
      expect(response).toEqual([]);
      expect(network.sendBlobSidecarsByRoot).not.toHaveBeenCalled();
    });
  });

  describe("fetchAndValidateColumns", () => {
    const forkName = ForkName.fulu;
    let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
    let missing: ColumnIndex[];

    beforeEach(() => {
      fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName, returnBlobs: true});
      missing = [0, 1, 2, 3, 4, 5, 6, 7]; // Sample a subset of columns
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it("should successfully fetch columns from network only", async () => {
      const neededColumns = fuluBlockWithColumns.columnSidecars.filter((c) => missing.includes(c.index));
      const sendDataColumnSidecarsByRootMock = vi.fn(() => Promise.resolve(neededColumns));
      network = {
        sendDataColumnSidecarsByRoot: sendDataColumnSidecarsByRootMock,
        custodyConfig: {
          custodyColumns: [0, 1, 2, 3, 4, 5],
          sampledColumns: missing,
        },
        logger: {
          error: vi.fn(),
        },
      } as unknown as INetwork;

      const response = await fetchAndValidateColumns({
        config,
        network,
        forkName,
        peerMeta,
        blockRoot: fuluBlockWithColumns.blockRoot,
        block: fuluBlockWithColumns.block,
        missing,
      });

      expect(sendDataColumnSidecarsByRootMock).toHaveBeenCalledExactlyOnceWith(peerIdStr, [
        {blockRoot: fuluBlockWithColumns.blockRoot, columns: missing},
      ]);
      expect(response.result.map((c) => c.index)).toEqual(missing);
    });

    it("should throw error if column validation fails", async () => {
      // biome-ignore lint/style/noNonNullAssertion: exists
      const invalidColumn = ssz.fulu.DataColumnSidecar.clone(fuluBlockWithColumns.columnSidecars.at(1)!);
      // Corrupt the inclusion proof to make validation fail
      invalidColumn.kzgCommitmentsInclusionProof[0] = new Uint8Array(32).fill(255);

      const sendDataColumnSidecarsByRootMock = vi.fn(() =>
        Promise.resolve([
          fuluBlockWithColumns.columnSidecars[0],
          invalidColumn,
          fuluBlockWithColumns.columnSidecars.slice(2, 6),
        ])
      );
      network = {
        sendDataColumnSidecarsByRoot: sendDataColumnSidecarsByRootMock,
        custodyConfig: {
          custodyColumns: [0, 1, 2, 3, 4, 5],
          sampledColumns: [0, 1, 2, 3, 4, 5],
        },
        logger: {
          error: vi.fn(),
        },
      } as unknown as INetwork;

      await expect(
        fetchAndValidateColumns({
          config,
          network,
          forkName,
          peerMeta,
          blockRoot: fuluBlockWithColumns.blockRoot,
          block: fuluBlockWithColumns.block,
          missing: [0, 1, 2, 3, 4, 5],
        })
      ).rejects.toThrow(DataColumnSidecarValidationError);
    });
  });

  describe("fetchColumnsByRoot", () => {
    let fuluBlockWithColumns: ReturnType<typeof generateBlockWithColumnSidecars>;
    beforeAll(() => {
      fuluBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.fulu});
      network = {
        sendDataColumnSidecarsByRoot: vi.fn(() => fuluBlockWithColumns.columnSidecars),
      } as unknown as INetwork;
    });
    afterAll(() => {
      vi.resetAllMocks();
    });
    it("should fetch missing columnSidecars ByRoot from network", async () => {
      const blockRoot = fuluBlockWithColumns.blockRoot;
      const missing = fuluBlockWithColumns.columnSidecars.map((c) => c.index);
      const response = await fetchColumnsByRoot({
        network,
        peerMeta,
        blockRoot,
        missing,
      });
      expect(response).toEqual(fuluBlockWithColumns.columnSidecars);
      expect(network.sendDataColumnSidecarsByRoot).toHaveBeenCalledOnce();
      expect(network.sendDataColumnSidecarsByRoot).toHaveBeenCalledWith(peerIdStr, [{blockRoot, columns: missing}]);
    });
  });
});
