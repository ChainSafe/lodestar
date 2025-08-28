import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, WithBytes, deneb, ssz} from "@lodestar/types";
import {Mock, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {INetwork} from "../../../../src/network/index.js";
import {
  DownloadByRangeError,
  DownloadByRangeRequests,
  DownloadByRangeResponses,
  requestByRange,
  validateBlobsByRangeResponse,
  validateBlockByRangeResponse,
} from "../../../../src/sync/utils/downloadByRange.js";
import {config, generateChainOfBlockMaybeSidecars, slots} from "../../../utils/blocksAndData.js";

describe("downloadByRange", () => {
  const peerIdStr = "0x1234567890abcdef";
  // let cache: SeenBlockInputCache;
  let network: INetwork;
  // const logger = getMockedLogger();

  const startSlot = slots.deneb;
  const count = 32;
  let requests!: DownloadByRangeRequests;
  let networkResponse!: {
    blocks: WithBytes<SignedBeaconBlock>[];
    blobSidecars: deneb.BlobSidecars;
  };
  let expected!: DownloadByRangeResponses;
  beforeAll(() => {
    // expectedBlobCount = count * minBlobs;
    requests = {
      blocksRequest: {startSlot, count, step: 1},
      blobsRequest: {count, startSlot},
    };
    const blockAndBlobs = generateChainOfBlockMaybeSidecars(ForkName.deneb, count);
    const blobSidecars = blockAndBlobs.flatMap(({blobSidecars}) => blobSidecars);
    networkResponse = {
      blocks: blockAndBlobs.map(({block}) => ({bytes: new Uint8Array(), data: block})),
      blobSidecars,
    };
    expected = {
      blocks: blockAndBlobs.map(({block}) => block),
      blobSidecars,
    };
  });

  beforeEach(() => {
    // const abortController = new AbortController();
    // const signal = abortController.signal;
    // cache = new SeenBlockInputCache({
    //   config,
    //   custodyConfig,
    //   clock: new Clock({config, signal, genesisTime: Math.floor(Date.now() / 1000)}),
    //   chainEvents: new ChainEventEmitter(),
    //   signal,
    //   metrics: null,
    //   logger,
    // });
    network = {
      sendBeaconBlocksByRange: vi.fn(),
      sendBlobSidecarsByRange: vi.fn(),
      // sendDataColumnSidecarsByRange: vi.fn(),
    } as unknown as INetwork;
  });

  // describe("downloadAndCacheByRange", () => {});
  // describe("downloadByRange", () => {});
  describe("requestByRange", () => {
    it("should make block requests", async () => {
      (network.sendBeaconBlocksByRange as Mock).mockResolvedValueOnce(networkResponse.blocks);
      const response = await requestByRange({
        network,
        peerIdStr,
        blocksRequest: requests.blocksRequest,
      });
      expect(network.sendBeaconBlocksByRange).toHaveBeenCalledWith(peerIdStr, requests.blocksRequest);
      expect(response.blocks).toEqual(expected.blocks);
    });

    it("should make blob requests", async () => {
      (network.sendBlobSidecarsByRange as Mock).mockResolvedValueOnce(networkResponse.blobSidecars);
      const response = await requestByRange({
        network,
        peerIdStr,
        blobsRequest: requests.blobsRequest,
      });
      expect(network.sendBlobSidecarsByRange).toHaveBeenCalledWith(peerIdStr, requests.blobsRequest);
      expect(response.blobSidecars).toEqual(expected.blobSidecars);
    });

    // it("should make column requests", async () => {
    //   const response = await requestByRange({
    //     network,
    //     peerIdStr,
    //     columnsRequest: requests.columnsRequest,
    //   });
    //   expect(network.sendColumnSidecarsByRange).toHaveBeenCalledWith(peerIdStr, requests.columnsRequest);
    //   expect(response.columnSidecars).toBe(expected.columnSidecars);
    // });

    it("should make concurrent block/blob/column requests from the same peer", async () => {
      (network.sendBeaconBlocksByRange as Mock).mockResolvedValueOnce(networkResponse.blocks);
      (network.sendBlobSidecarsByRange as Mock).mockResolvedValueOnce(networkResponse.blobSidecars);
      const response = await requestByRange({
        network,
        peerIdStr,
        blocksRequest: requests.blocksRequest,
        blobsRequest: requests.blobsRequest,
        // columnsRequest: requests.columnsRequest,
      });
      expect(network.sendBeaconBlocksByRange).toHaveBeenCalledWith(peerIdStr, requests.blocksRequest);
      expect(network.sendBlobSidecarsByRange).toHaveBeenCalledWith(peerIdStr, requests.blobsRequest);
      // expect(network.sendColumnSidecarsByRange).toHaveBeenCalledWith(peerIdStr, requests.columnsRequest);
      expect(response.blocks).toEqual(expected.blocks);
      expect(response.blobSidecars).toEqual(expected.blobSidecars);
      // expect(response.columnSidecars).toBe(expected.columnSidecars);
    });

    it("should throw if one of the calls fails", async () => {
      (network.sendBeaconBlocksByRange as Mock).mockResolvedValueOnce(networkResponse.blocks);
      const rejectionError = new Error("TEST_ERROR_MESSAGE");
      (network.sendBlobSidecarsByRange as Mock).mockRejectedValueOnce(rejectionError);
      try {
        await requestByRange({
          network,
          peerIdStr,
          blocksRequest: requests.blocksRequest,
          blobsRequest: requests.blobsRequest,
          // columnsRequest: requests.columnsRequest,
        });
        expect.fail("Did not fail as expected");
      } catch (e) {
        expect(e).toBe(rejectionError);
      } finally {
        expect(network.sendBeaconBlocksByRange).toHaveBeenCalledWith(peerIdStr, requests.blocksRequest);
        expect(network.sendBlobSidecarsByRange).toHaveBeenCalledWith(peerIdStr, requests.blobsRequest);
      }
    });
  });
  describe("validateBlockByRangeRequest", () => {
    const block1 = ssz.capella.SignedBeaconBlock.defaultValue();
    block1.message.slot = slots.capella;
    const block2 = ssz.capella.SignedBeaconBlock.defaultValue();
    block2.message.slot = slots.capella + 1;
    block2.message.parentRoot = config.getForkTypes(block1.message.slot).BeaconBlock.hashTreeRoot(block1.message);
    const block3 = ssz.capella.SignedBeaconBlock.defaultValue();
    block3.message.slot = slots.capella + 2;
    block3.message.parentRoot = config.getForkTypes(block2.message.slot).BeaconBlock.hashTreeRoot(block2.message);
    const block4 = ssz.capella.SignedBeaconBlock.defaultValue();
    block4.message.slot = slots.capella + 3;
    block4.message.parentRoot = config.getForkTypes(block3.message.slot).BeaconBlock.hashTreeRoot(block3.message);
    const block5 = ssz.capella.SignedBeaconBlock.defaultValue();
    block5.message.slot = slots.capella + 4;
    block5.message.parentRoot = config.getForkTypes(block4.message.slot).BeaconBlock.hashTreeRoot(block4.message);

    it("should correctly match request with response", () => {
      const blockRoots = validateBlockByRangeResponse(
        config,
        {
          startSlot: slots.capella,
          count: 5,
          step: 1,
        },
        [block1, block2, block3, block4, block5]
      );
      expect(blockRoots).toBeInstanceOf(Array);
      expect(blockRoots.length).toEqual(5);
    });

    it("should throw if there are duplicates within the given range", () => {
      expect(() =>
        validateBlockByRangeResponse(
          config,
          {
            startSlot: slots.capella,
            count: 4,
            step: 1,
          },
          [block1, block2, block3, block4, block4]
        )
      ).toThrow(DownloadByRangeError);
    });

    it("should throw if more blocks than were requested", () => {
      expect(() =>
        validateBlockByRangeResponse(
          config,
          {
            startSlot: slots.capella,
            count: 4,
            step: 1,
          },
          [block1, block2, block3, block4, block5]
        )
      ).toThrow(DownloadByRangeError);
    });

    it("should throw if blocks are returned out of order", () => {
      expect(() =>
        validateBlockByRangeResponse(
          config,
          {
            startSlot: slots.capella,
            count: 5,
            step: 1,
          },
          [block1, block3, block2, block4, block5]
        )
      ).toThrow(DownloadByRangeError);
    });
  });
  describe("compareBlobsByRangeRequestAndResponse", () => {
    const expectedBlocks = expected.blocks as SignedBeaconBlock[];
    const expectedBlobSidecars = expected.blobSidecars as deneb.BlobSidecars;

    it("should not throw when all blobs are present in response", () => {
      expect(() => validateBlobsByRangeResponse(expectedBlocks, expectedBlobSidecars)).not.toThrow();
    });

    it("should throw when blobs are missing from response", () => {
      expect(() => validateBlobsByRangeResponse(expectedBlocks, expectedBlobSidecars.slice(0, -4))).toThrow(
        DownloadByRangeError
      );
    });

    it("should throw when extra blobs are in response", () => {
      expect(() =>
        validateBlobsByRangeResponse(expectedBlocks.slice(0, 1), expectedBlobSidecars.concat(expectedBlobSidecars))
      ).toThrow(DownloadByRangeError);
    });

    it("should throw when blobs are not in order", () => {
      const blobSidecars = expectedBlobSidecars.slice().reverse();
      expect(() => validateBlobsByRangeResponse(expectedBlocks, blobSidecars)).toThrow(DownloadByRangeError);
    });
  });
  describe("validateResponse", () => {
    it("should throw if there are no blocks to validate", () => {});
    it("should throw for responses missing block from requested slots", () => {});
    it("should throw for extra block from slots that were not requested", () => {});
    it("should throw for duplicate blocks from requested slots", () => {});

    it("should throw if there are no blobs but there was a blobsRequest", () => {});
    it("should throw for missing blobs in slots that were requested", () => {});

    it("should throw if there are no columns but there was a columnsRequest", () => {});
  });
  // describe("compareColumnsByRangeRequestAndResponse", () => {});
  // describe("compareByRangeRequestsToResponse", () => {});
});
