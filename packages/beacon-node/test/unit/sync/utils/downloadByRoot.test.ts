import {randomBytes} from "node:crypto";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, ssz} from "@lodestar/types";
import {DataColumnSidecarValidationError} from "../../../../src/chain/errors/dataColumnSidecarError.js";
import {INetwork} from "../../../../src/network/index.js";
import {PeerSyncMeta} from "../../../../src/network/peers/peersData.js";
import {PendingBlockInputStatus} from "../../../../src/sync/types.js";
import {
  DownloadByRootError,
  fetchAndValidateBlock,
  fetchAndValidateColumns,
  fetchByRoot,
  fetchColumnsByRoot,
} from "../../../../src/sync/utils/downloadByRoot.js";
import {ROOT_SIZE} from "../../../../src/util/sszBytes.js";
import {
  BlockWithColumnsTestSet,
  config,
  generateBlock,
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
        sendBeaconBlocksByRoot: vi.fn(() => [capellaBlock.block]),
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
        sendBeaconBlocksByRoot: vi.fn(() => [capellaBlock.block]),
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

  describe("fetchAndValidateColumns", () => {
    const forkName = ForkName.fulu;
    let fuluBlockWithColumns: BlockWithColumnsTestSet<ForkName.fulu>;
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
        chain: null,
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
          chain: null,
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

  describe("fetchByRoot", () => {
    afterEach(() => {
      vi.resetAllMocks();
    });

    it("does not fetch columns for bare-root gloas block sync", async () => {
      const gloasBlockWithColumns = generateBlockWithColumnSidecars({forkName: ForkName.gloas});
      const sendBeaconBlocksByRoot = vi.fn(() => Promise.resolve([gloasBlockWithColumns.block]));
      const sendDataColumnSidecarsByRoot = vi.fn();
      network = {
        sendBeaconBlocksByRoot,
        sendDataColumnSidecarsByRoot,
      } as unknown as INetwork;

      const response = await fetchByRoot({
        config,
        chain: null,
        network,
        peerMeta,
        blockRoot: gloasBlockWithColumns.blockRoot,
        cacheItem: {
          status: PendingBlockInputStatus.pending,
          rootHex: gloasBlockWithColumns.rootHex,
          timeAddedSec: 0,
          peerIdStrings: new Set(),
        },
      });

      expect(sendBeaconBlocksByRoot).toHaveBeenCalledOnce();
      expect(sendDataColumnSidecarsByRoot).not.toHaveBeenCalled();
      expect(response.result.block).toEqual(gloasBlockWithColumns.block);
      expect(response.result.columnSidecars).toBeUndefined();
    });
  });

  describe("fetchColumnsByRoot", () => {
    let fuluBlockWithColumns: BlockWithColumnsTestSet<ForkName.fulu>;
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
