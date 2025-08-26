import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {SignedBeaconBlock, WithBytes, deneb, ssz} from "@lodestar/types";
import {Mock, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ChainEventEmitter} from "../../../../src/chain/index.js";
import {SeenBlockInputCache} from "../../../../src/chain/seenCache/seenBlockInput.js";
import {INetwork} from "../../../../src/network/index.js";
import {
  DownloadByRangeRequests,
  DownloadByRangeResponses,
  compareBlobsByRangeRequestAndResponse,
  compareBlockByRangeRequestAndResponse,
  requestByRange,
  validateRequests,
} from "../../../../src/sync/utils/downloadByRange.js";
import {Clock} from "../../../../src/util/clock.js";
import {getMockedLogger} from "../../../../test/mocks/loggerMock.js";
import {config, custodyConfig, generateChainOfBlockMaybeSidecars, slots} from "../../../utils/blocksAndData.js";

describe("downloadByRange", () => {
  const peerIdStr = "0x1234567890abcdef";
  let cache: SeenBlockInputCache;
  let network: INetwork;
  const logger = getMockedLogger();

  const startSlot = slots.deneb;
  const count = 32;
  const minBlobs = 2;
  const maxBlobs = 2;
  let requests!: DownloadByRangeRequests;
  let networkResponse!: {
    blocks: WithBytes<SignedBeaconBlock>[];
    blobSidecars: deneb.BlobSidecars;
  };
  let expected!: DownloadByRangeResponses;
  beforeAll(() => {
    // expectedBlobCount = count * minBlobs;
    requests = {
      blocksRequest: [{startSlot, count, step: 1}],
      blobsRequest: [{count, startSlot}],
    };
    const blockAndBlobs = generateChainOfBlockMaybeSidecars(ForkName.deneb, startSlot, count, minBlobs, maxBlobs);
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
    const abortController = new AbortController();
    const signal = abortController.signal;
    cache = new SeenBlockInputCache({
      config,
      custodyConfig,
      clock: new Clock({config, signal, genesisTime: Math.floor(Date.now() / 1000)}),
      chainEvents: new ChainEventEmitter(),
      signal,
      metrics: null,
      logger,
    });
    network = {
      sendBeaconBlocksByRange: vi.fn(),
      sendBlobSidecarsByRange: vi.fn(),
      // sendDataColumnSidecarsByRange: vi.fn(),
    } as unknown as INetwork;
  });

  // describe("downloadAndCacheByRange", () => {});
  // describe("downloadByRange", () => {});
  describe("validateRequests", () => {
    it("should return a slot-range string for unavailable data", () => {
      expect(
        typeof validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.PreData,
          blocksRequest: {startSlot: slots.capella, count: 1},
        }) === "string"
      ).toBeTruthy();
      expect(
        typeof validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.OutOfRange,
          blocksRequest: {startSlot: slots.deneb, count: 1},
        }) === "string"
      ).toBeTruthy();
    });
    it("should throw for data requests outside of the data availability window", () => {
      expect(() =>
        validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.OutOfRange,
          blocksRequest: {startSlot: slots.deneb, count: 1},
          blobsRequest: {startSlot: slots.deneb, count: 1},
        })
      ).toThrow("Cannot request data if it is not available");
    });
    it("should throw for missing data request within data availability window", () => {
      expect(() =>
        validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.deneb, count: 1},
        })
      ).toThrow("Must request data if it is available");
    });
    it("should throw if requesting blobs and columns", () => {
      expect(() =>
        validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.deneb, count: 1},
          blobsRequest: {startSlot: slots.deneb, count: 1},
          columnsRequest: {startSlot: slots.fulu, count: 1},
        })
      ).toThrow();
    });
    it("should throw for data request pre-deneb", () => {
      expect(() =>
        validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.capella, count: 1},
          columnsRequest: {startSlot: slots.capella, count: 1},
        })
      ).toThrow("Cannot request data pre-deneb");
    });
    it("should throw for missing blobsRequest on blob-fork when data is available", () => {
      expect(() =>
        validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.deneb, count: 1},
          columnsRequest: {startSlot: slots.deneb, count: 1},
        })
      ).toThrow("Must request blobs for blob-only forks");
    });
    it("should throw for missing columnsRequest on column-fork when data is available", () => {
      expect(() =>
        validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.fulu, count: 1},
          blobsRequest: {startSlot: slots.fulu, count: 1},
        })
      ).toThrow("Must request columns for forks with columns");
    });
    it("should throw for mismatch block/data startSlot", () => {
      expect(() =>
        validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.deneb, count: 1},
          blobsRequest: {startSlot: slots.deneb + 1, count: 1},
        })
      ).toThrow();
    });
    it("should throw for mismatch block/data count", () => {
      expect(() =>
        validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.deneb, count: 1},
          blobsRequest: {startSlot: slots.deneb, count: 2},
        })
      ).toThrow();
    });
    it("should return a slot-range string for properly formatted blob-fork requests", () => {
      expect(
        typeof validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.deneb, count: 1},
          blobsRequest: {startSlot: slots.deneb, count: 1},
        }) === "string"
      ).toBeTruthy();
    });
    it("should return a slot-range string for properly formatted column-fork requests", () => {
      expect(
        typeof validateRequests({
          config,
          daOutOfRange: DataAvailabilityStatus.Available,
          blocksRequest: {startSlot: slots.fulu, count: 1},
          columnsRequest: {startSlot: slots.fulu, count: 1},
        }) === "string"
      ).toBeTruthy();
    });
  });
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
  describe("compareBlockByRangeRequestAndResponse", () => {
    const block1 = ssz.capella.SignedBeaconBlock.defaultValue();
    block1.message.slot = slots.capella;
    const block2 = ssz.capella.SignedBeaconBlock.defaultValue();
    block2.message.slot = slots.capella + 1;
    const block3 = ssz.capella.SignedBeaconBlock.defaultValue();
    block3.message.slot = slots.capella + 2;
    const block4 = ssz.capella.SignedBeaconBlock.defaultValue();
    block4.message.slot = slots.capella + 3;
    const block5 = ssz.capella.SignedBeaconBlock.defaultValue();
    block5.message.slot = slots.capella + 4;
    it("should always return an object", () => {
      const response = compareBlockByRangeRequestAndResponse(
        {
          startSlot: slots.capella,
          count: 0,
        },
        []
      );
      expect(response).toBeInstanceOf(Object);
      expect(Object.keys(response).length).toEqual(0);
    });
    it("should correctly match request with response", () => {
      const response = compareBlockByRangeRequestAndResponse(
        {
          startSlot: slots.capella,
          count: 5,
        },
        [block1, block2, block3, block4, block5]
      );
      expect(response).toBeInstanceOf(Object);
      expect(Object.keys(response).length).toEqual(0);
    });
    it("should return an empty extraSlots array for duplicates within the given range", () => {
      const response = compareBlockByRangeRequestAndResponse(
        {
          startSlot: slots.capella,
          count: 4,
        },
        [block1, block2, block3, block4, block4]
      );
      expect(response).toBeInstanceOf(Object);
      expect(Object.keys(response).length).toEqual(1);
      expect("extraSlots" in response).toBeTruthy();
      expect(response.extraSlots).toBeInstanceOf(Array);
      expect(response.extraSlots.length).toEqual(0);
    });
    it("should return the extra slots if more blocks than were requested", () => {
      const response = compareBlockByRangeRequestAndResponse(
        {
          startSlot: slots.capella,
          count: 4,
        },
        [block1, block2, block3, block4, block5]
      );
      expect(response).toBeInstanceOf(Object);
      expect(Object.keys(response).length).toEqual(1);
      expect("extraSlots" in response).toBeTruthy();
      expect(response.extraSlots).toBeInstanceOf(Array);
      expect(response.extraSlots.length).toEqual(1);
      expect(response.extraSlots[0]).toEqual(block5.message.slot);
    });
    describe("should return the missing slots if less blocks than were requested", () => {
      it("beginning of range", () => {
        const response = compareBlockByRangeRequestAndResponse(
          {
            startSlot: slots.capella,
            count: 5,
          },
          [block2, block3, block4, block5]
        );
        expect(response).toBeInstanceOf(Object);
        expect(Object.keys(response).length).toEqual(1);
        expect("missingSlots" in response).toBeTruthy();
        expect(response.missingSlots).toBeInstanceOf(Array);
        expect(response.missingSlots.length).toEqual(1);
        expect(response.missingSlots[0]).toEqual(block1.message.slot);
      });
      it("middle of range", () => {
        const response = compareBlockByRangeRequestAndResponse(
          {
            startSlot: slots.capella,
            count: 5,
          },
          [block1, block2, block4, block5]
        );
        expect(response).toBeInstanceOf(Object);
        expect(Object.keys(response).length).toEqual(1);
        expect("missingSlots" in response).toBeTruthy();
        expect(response.missingSlots).toBeInstanceOf(Array);
        expect(response.missingSlots.length).toEqual(1);
        expect(response.missingSlots[0]).toEqual(block3.message.slot);
      });
      it("end of range", () => {
        const response = compareBlockByRangeRequestAndResponse(
          {
            startSlot: slots.capella,
            count: 5,
          },
          [block1, block2, block3, block4]
        );
        expect(response).toBeInstanceOf(Object);
        expect(Object.keys(response).length).toEqual(1);
        expect("missingSlots" in response).toBeTruthy();
        expect(response.missingSlots).toBeInstanceOf(Array);
        expect(response.missingSlots.length).toEqual(1);
        expect(response.missingSlots[0]).toEqual(block5.message.slot);
      });
    });
  });
  describe("compareBlobsByRangeRequestAndResponse", () => {
    it("should return a properly formatted object", () => {
      const response = compareBlobsByRangeRequestAndResponse([], []);
      expect(response).instanceOf(Object);
      expect(Object.keys(response).length).toEqual(7);
      expect(response.expectedBlobCount).toEqual(0);
      expect(response.missingBlobCount).toEqual(0);
      expect(response.extraBlobCount).toEqual(0);
      expect(response.duplicateBlobCount).toEqual(0);
      expect(response.missingBlobsDescription).toBeInstanceOf(Array);
      expect(response.missingBlobsDescription.length).toEqual(0);
      expect(response.extraBlobsDescription).toBeInstanceOf(Array);
      expect(response.extraBlobsDescription.length).toEqual(0);
      expect(response.duplicateBlobsDescription).toBeInstanceOf(Array);
      expect(response.duplicateBlobsDescription.length).toEqual(0);
    });
    it("should identify requested blobs missing from response", () => {
      const response = compareBlobsByRangeRequestAndResponse(expected.blocks, expected.blobSidecars?.slice(0, -4));
      expect(response.missingBlobCount).toEqual(4);
      expect(response.missingBlobsDescription.length).toEqual(2);
      const lastSlot = startSlot + count - 1;
      expect(response.missingBlobsDescription[0]).toEqual(`${lastSlot - 1}[2]`);
      expect(response.missingBlobsDescription[1]).toEqual(`${lastSlot}[0,1,2]`);
    });
    it("should identify extra blobs from blocks that were requested", () => {
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      const [blob0, blob1, blob2, blob3] = expected.blobSidecars!;
      const badBlob = ssz.deneb.BlobSidecar.clone(blob3);
      badBlob.signedBlockHeader.message.slot = blob2.signedBlockHeader.message.slot;
      badBlob.index = 3;
      const response = compareBlobsByRangeRequestAndResponse(expected.blocks?.slice(0, 1), [
        blob0,
        blob1,
        blob2,
        badBlob,
      ]);
      expect(response.extraBlobCount).toEqual(1);
      expect(response.extraBlobsDescription.length).toEqual(1);
      expect(response.extraBlobsDescription[0]).toEqual(`${expected.blocks[0].message.slot}[3]`);
    });
    it("should identify extra blobs from blocks that were requested", () => {
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      const [blob0, blob1, blob2] = expected.blobSidecars!;
      const badBlob = ssz.deneb.BlobSidecar.clone(blob2);
      const response = compareBlobsByRangeRequestAndResponse(expected.blocks?.slice(0, 1), [
        blob0,
        blob1,
        blob2,
        badBlob,
      ]);
      expect(response.duplicateBlobCount).toEqual(1);
      expect(response.duplicateBlobsDescription.length).toEqual(1);
      expect(response.duplicateBlobsDescription[0]).toEqual(`${expected.blocks[0].message.slot}[2]`);
    });
    it("should identify extra blobs from blocks that were not requested", () => {
      const response = compareBlobsByRangeRequestAndResponse(
        expected.blocks?.slice(0, 1),
        expected.blobSidecars?.slice(0, 6)
      );
      expect(response.extraBlobCount).toEqual(3);
      expect(response.extraBlobsDescription.length).toEqual(1);
      expect(response.extraBlobsDescription[0]).toEqual(`${expected.blocks[1].message.slot}[0,1,2]`);
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
