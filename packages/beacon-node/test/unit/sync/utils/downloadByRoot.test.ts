import {randomBytes} from "node:crypto";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {BlobIndex, ColumnIndex, ssz} from "@lodestar/types";
import {BlobMeta} from "../../../../src/chain/blocks/blockInput/types.js";
import {BlobSidecarValidationError} from "../../../../src/chain/errors/blobSidecarError.js";
import {DataColumnSidecarValidationError} from "../../../../src/chain/errors/dataColumnSidecarError.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {INetwork} from "../../../../src/network/index.js";
import {PeerSyncMeta} from "../../../../src/network/peers/peersData.js";
import * as envelopeAdmission from "../../../../src/sync/target/envelopeAdmission.js";
import {fetchAndValidateExecutionPayloadEnvelopeByRoot} from "../../../../src/sync/target/fetchEnvelopeByRoot.js";
import {PendingBlockInputStatus} from "../../../../src/sync/types.js";
import {
  DownloadByRootError,
  DownloadByRootErrorCode,
  fetchAndValidateBlobs,
  fetchAndValidateBlock,
  fetchAndValidateColumns,
  fetchBlobsByRoot,
  fetchByRoot,
} from "../../../../src/sync/utils/downloadByRoot.js";
import {ROOT_SIZE} from "../../../../src/util/sszBytes.js";
import {
  BlockWithColumnsTestSet,
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
        chain: null,
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
        chain: null,
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
          chain: null,
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

    it("validates gloas column sidecars via the gloas validator (not the fulu validator)", async () => {
      const gloasBlockWithColumns: BlockWithColumnsTestSet<ForkName.gloas> = generateBlockWithColumnSidecars({
        forkName: ForkName.gloas,
      });
      network = {
        sendDataColumnSidecarsByRoot: vi.fn(() => gloasBlockWithColumns.columnSidecars),
      } as unknown as INetwork;

      const result = await fetchAndValidateColumns({
        config,
        chain: null,
        network,
        peerMeta,
        forkName: ForkName.gloas,
        block: gloasBlockWithColumns.block,
        blockRoot: gloasBlockWithColumns.blockRoot,
        missing: gloasBlockWithColumns.columnSidecars.map((c) => c.index),
      });

      expect(result.warnings).toBeNull();
      expect(result.result).toEqual(gloasBlockWithColumns.columnSidecars);
    });

    it("rejects a gloas column sidecar whose kzg proofs are corrupted (gloas validator is not a no-op)", async () => {
      const gloasBlockWithColumns: BlockWithColumnsTestSet<ForkName.gloas> = generateBlockWithColumnSidecars({
        forkName: ForkName.gloas,
      });
      // Corrupt the first column's kzgProofs with random bytes — count stays the same so only the
      // KZG batch verification check (asyncVerifyCellKzgProofBatch) can reject it.
      const corruptedSidecars = gloasBlockWithColumns.columnSidecars.map((c, i) =>
        i === 0 ? {...c, kzgProofs: c.kzgProofs.map(() => randomBytes(48))} : c
      );
      network = {
        sendDataColumnSidecarsByRoot: vi.fn(() => corruptedSidecars),
      } as unknown as INetwork;

      await expect(
        fetchAndValidateColumns({
          config,
          chain: null,
          network,
          peerMeta,
          forkName: ForkName.gloas,
          block: gloasBlockWithColumns.block,
          blockRoot: gloasBlockWithColumns.blockRoot,
          missing: gloasBlockWithColumns.columnSidecars.map((c) => c.index),
        })
      ).rejects.toBeInstanceOf(DataColumnSidecarValidationError);
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

  describe("fetchAndValidateExecutionPayloadEnvelopeByRoot", () => {
    const sampledColumns = Array.from({length: 8}, (_, i) => i);
    const custodyColumns = Array.from({length: 4}, (_, i) => i);
    const seenTimestampSec = 1_700_000_000;

    let gloasBlock: ReturnType<typeof generateBlock<ForkName.gloas>>;

    beforeEach(() => {
      gloasBlock = generateBlock({forkName: ForkName.gloas});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function buildChainMock(): IBeaconChain {
      const payloadInput = {} as ReturnType<NonNullable<IBeaconChain["seenPayloadEnvelopeInputCache"]>["add"]>;
      return {
        config,
        pubkeyCache: {},
        bls: {},
        getHeadState: vi.fn(() => ({})),
        custodyConfig: {sampledColumns, custodyColumns},
        seenPayloadEnvelopeInputCache: {
          get: vi.fn(() => payloadInput),
          add: vi.fn(() => payloadInput),
        },
      } as unknown as IBeaconChain;
    }

    it("envelope returned and admitted → result ADMITTED, no warnings, admitEnvelopeByRoot called once", async () => {
      const admitSpy = vi.spyOn(envelopeAdmission, "admitEnvelopeByRoot").mockResolvedValueOnce("ADMITTED");

      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = gloasBlock.blockRoot;

      network = {
        sendExecutionPayloadEnvelopesByRoot: vi.fn(() => Promise.resolve([envelope])),
      } as unknown as INetwork;

      const chain = buildChainMock();

      const response = await fetchAndValidateExecutionPayloadEnvelopeByRoot({
        config,
        chain,
        network,
        peerIdStr,
        blockRoot: gloasBlock.blockRoot,
        blockRootHex: gloasBlock.rootHex,
        block: gloasBlock.block,
        seenTimestampSec,
      });

      expect(response.result).toBe("ADMITTED");
      expect(response.warnings).toBeNull();
      expect(admitSpy).toHaveBeenCalledOnce();
    });

    it("envelope beaconBlockRoot mismatch → REJECTED, admitEnvelopeByRoot NOT called", async () => {
      const admitSpy = vi.spyOn(envelopeAdmission, "admitEnvelopeByRoot");

      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      // Served an envelope for a different block (builder equivocation).
      envelope.message.beaconBlockRoot = new Uint8Array(32).fill(0xff);

      network = {
        sendExecutionPayloadEnvelopesByRoot: vi.fn(() => Promise.resolve([envelope])),
      } as unknown as INetwork;

      const chain = buildChainMock();

      const response = await fetchAndValidateExecutionPayloadEnvelopeByRoot({
        config,
        chain,
        network,
        peerIdStr,
        blockRoot: gloasBlock.blockRoot,
        blockRootHex: gloasBlock.rootHex,
        block: gloasBlock.block,
        seenTimestampSec,
      });

      expect(response.result).toBe("REJECTED");
      expect(response.warnings?.[0]).toBeInstanceOf(DownloadByRootError);
      expect(admitSpy).not.toHaveBeenCalled();
    });

    it("empty network response → warning with MISSING_ENVELOPE_RESPONSE, no throw", async () => {
      const admitSpy = vi.spyOn(envelopeAdmission, "admitEnvelopeByRoot");

      network = {
        sendExecutionPayloadEnvelopesByRoot: vi.fn(() => Promise.resolve([])),
      } as unknown as INetwork;

      const chain = buildChainMock();

      const response = await fetchAndValidateExecutionPayloadEnvelopeByRoot({
        config,
        chain,
        network,
        peerIdStr,
        blockRoot: gloasBlock.blockRoot,
        blockRootHex: gloasBlock.rootHex,
        block: gloasBlock.block,
        seenTimestampSec,
      });

      expect(response.result).toBe("PEER_MISS");
      expect(response.warnings).not.toBeNull();
      expect(response.warnings?.[0]).toBeInstanceOf(DownloadByRootError);
      expect(response.warnings?.[0]?.type.code).toBe(DownloadByRootErrorCode.MISSING_ENVELOPE_RESPONSE);
      expect(admitSpy).not.toHaveBeenCalled();
    });

    it("admission REJECTED → peer-fault warning with ENVELOPE_REJECTED code, result REJECTED", async () => {
      vi.spyOn(envelopeAdmission, "admitEnvelopeByRoot").mockResolvedValueOnce("REJECTED");

      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = gloasBlock.blockRoot;

      network = {
        sendExecutionPayloadEnvelopesByRoot: vi.fn(() => Promise.resolve([envelope])),
      } as unknown as INetwork;

      const chain = buildChainMock();

      const response = await fetchAndValidateExecutionPayloadEnvelopeByRoot({
        config,
        chain,
        network,
        peerIdStr,
        blockRoot: gloasBlock.blockRoot,
        blockRootHex: gloasBlock.rootHex,
        block: gloasBlock.block,
        seenTimestampSec,
      });

      expect(response.result).toBe("REJECTED");
      expect(response.warnings).not.toBeNull();
      expect(response.warnings?.[0]).toBeInstanceOf(DownloadByRootError);
      expect(response.warnings?.[0]?.type.code).toBe(DownloadByRootErrorCode.ENVELOPE_REJECTED);
    });
  });
});
