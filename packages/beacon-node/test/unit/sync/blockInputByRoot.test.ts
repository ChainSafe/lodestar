import {beforeEach, describe, expect, it, vi} from "vitest";

// --- Module under test ------------------------------------------------------
// Adjust the relative import path so it points to the file you asked to test
import {
  DownloadByRootError,
  downloadAndCacheBlock,
  downloadAndCacheData,
  downloadBlockInputByRoot,
} from "../../../src/sync/utils/downloadBlockInputByRoot.js";

import {ChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {deneb} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {
  BlockInputBlobs,
  BlockInputPreData,
  BlockInputSource,
  DAType,
  IBlockInput,
} from "../../../src/chain/blocks/blockInput/index.js";
import {SeenBlockInputCache} from "../../../src/chain/seenCache/seenBlockInput.js";
import {IExecutionEngine} from "../../../src/execution/index.js";
import {INetwork} from "../../../src/network/index.js";
import {PendingBlockInput, PendingBlockInputStatus, PendingRootHex} from "../../../src/sync/types.js";

function 

describe("downloadBlockInputByRoot", ()
=>
{
  let config: ChainForkConfig;
  let network: INetwork;
  let cache: SeenBlockInputCache;
  let executionEngine: IExecutionEngine;
  let peerIdStr: string;
  let blockRootHex: string;
  let blockRoot: Uint8Array;
  let signedBeaconBlock: deneb.SignedBeaconBlock;
  let forkName: ForkName;

  beforeEach(() => {
    config = createChainForkConfig(defaultChainConfig);
    network = {
      sendBeaconBlocksByRoot: vi.fn(),
      sendBlobSidecarsByRoot: vi.fn(),
    } as unknown as INetwork;
    cache = new SeenBlockInputCache();
    executionEngine = {
      getBlobs: vi.fn(),
    } as unknown as IExecutionEngine;
    peerIdStr = "peer1";
    signedBeaconBlock = generateSignedBeaconBlock({message: {slot: 100}});
    blockRoot = config.getForkTypes(signedBeaconBlock.message.slot).BeaconBlock.hashTreeRoot(signedBeaconBlock.message);
    blockRootHex = toHex(blockRoot);
    forkName =
  });

  describe("downloadBlockInputByRoot", () => {
    it("should download block and data for PendingRootHex", async () => {
      const pending: PendingRootHex = {
        status: PendingBlockInputStatus.pending,
        rootHex: blockRootHex,
        timeAddedSec: Date.now() / 1000,
        peerIdStrings: new Set(),
      };

      vi.spyOn(network, "sendBeaconBlocksByRoot").mockResolvedValue([
        {data: signedBeaconBlock, bytes: new Uint8Array()},
      ]);
      vi.spyOn(executionEngine, "getBlobs").mockResolvedValue([null]);

      const result = await downloadBlockInputByRoot({
        config,
        network,
        cache,
        executionEngine,
        pending,
        peerIdStr,
      });

      expect(result).toBeDefined();
      expect(result.status).toBe("pending");
      expect(result.blockInput.hasBlock()).toBe(true);
      expect(network.sendBeaconBlocksByRoot).toHaveBeenCalledWith(peerIdStr, [blockRoot]);
    });

    it("should download missing data for PendingBlockInput with partial data", async () => {
      const blockInput = cache.getBlockInputByBlock({
        block: signedBeaconBlock,
        source: BlockInputSource.byRoot,
        seenTimestampSec: Date.now(),
        peerIdStr,
      });
      const pending: PendingBlockInput = {
        status: PendingBlockInputStatus.pending,
        blockInput,
        timeAddedSec: Date.now() / 1000,
        peerIdStrings: new Set(),
      };

      const blobSidecar = generateBlobSidecar({index: 0});
      vi.spyOn(network, "sendBlobSidecarsByRoot").mockResolvedValue([blobSidecar]);
      vi.spyOn(executionEngine, "getBlobs").mockResolvedValue([null]);

      const result = await downloadBlockInputByRoot({
        config,
        network,
        cache,
        executionEngine,
        pending,
        peerIdStr,
      });

      expect(result).toBe(pending);
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalled();
      expect(result.blockInput.hasAllData()).toBe(true);
    });

    it("should throw if blockInput type is invalid", async () => {
      const blockInput = {
        type: DAType.PreData,
        blockRootHex,
        hasBlock: () => true,
        hasAllData: () => false,
        getBlock: () => signedBeaconBlock,
      } as unknown as IBlockInput;
      const pending: PendingBlockInput = {
        status: PendingBlockInputStatus.pending,
        blockInput,
        timeAddedSec: Date.now() / 1000,
        peerIdStrings: new Set(),
      };

      await expect(
        downloadBlockInputByRoot({
          config,
          network,
          cache,
          executionEngine,
          pending,
          peerIdStr,
        })
      ).rejects.toThrow(DownloadByRootError);
    });
  });

  describe("downloadAndCacheBlock", () => {
    it("should download and cache block for PendingRootHex", async () => {
      const pending: PendingRootHex = {
        status: PendingBlockInputStatus.pending,
        rootHex: blockRootHex,
        timeAddedSec: Date.now() / 1000,
        peerIdStrings: new Set(),
      };

      vi.spyOn(network, "sendBeaconBlocksByRoot").mockResolvedValue([
        {data: signedBeaconBlock, bytes: new Uint8Array()},
      ]);

      const result = await downloadAndCacheBlock({
        network,
        cache,
        pending,
        peerIdStr,
      });

      expect(result).toBeDefined();
      expect(result.blockInput.hasBlock()).toBe(true);
      expect(network.sendBeaconBlocksByRoot).toHaveBeenCalledWith(peerIdStr, [blockRoot]);
    });

    it("should update existing PendingBlockInput with block", async () => {
      const blockInput = cache.getBlockInputByBlock({
        block: null,
        source: BlockInputSource.byRoot,
        seenTimestampSec: Date.now(),
        peerIdStr,
      });
      const pending: PendingBlockInput = {
        status: "pending",
        blockInput,
        timeAddedSec: Date.now() / 1000,
        peerIdStrings: new Set(),
      };

      vi.spyOn(network, "sendBeaconBlocksByRoot").mockResolvedValue([
        {data: signedBeaconBlock, bytes: new Uint8Array()},
      ]);

      const result = await downloadAndCacheBlock({
        network,
        cache,
        pending,
        peerIdStr,
      });

      expect(result).toBe(pending);
      expect(result.blockInput.hasBlock()).toBe(true);
    });
  });

  describe("downloadAndCacheData", () => {
    it("should download blobs from execution engine and network", async () => {
      const blockInput = cache.getBlockInputByBlock({
        block: signedBeaconBlock,
        source: BlockInputSource.byRoot,
        seenTimestampSec: Date.now(),
        peerIdStr,
      }) as IBlockInput;
      blockInput.addBlobKzgCommitments([fromHex("0x1234")]);

      const blobAndProof = {blob: new Uint8Array([1, 2, 3]), proof: new Uint8Array([4, 5, 6])};
      vi.spyOn(executionEngine, "getBlobs").mockResolvedValue([blobAndProof]);
      const blobSidecar = generateBlobSidecar({index: 0});
      vi.spyOn(network, "sendBlobSidecarsByRoot").mockResolvedValue([blobSidecar]);

      await downloadAndCacheData({
        config,
        network,
        executionEngine,
        blockInput,
        peerIdStr,
      });

      expect(executionEngine.getBlobs).toHaveBeenCalled();
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalled();
      expect(blockInput.hasAllData()).toBe(true);
    });

    it("should handle partial data from execution engine", async () => {
      const blockInput = cache.getBlockInputByBlock({
        block: signedBeaconBlock,
        source: BlockInputSource.byRoot,
        seenTimestampSec: Date.now(),
        peerIdStr,
      }) as BlockInputBlobs;
      blockInput.addBlobKzgCommitments([fromHex("0x1234")]);

      vi.spyOn(executionEngine, "getBlobs").mockResolvedValue([null]);
      const blobSidecar = generateBlobSidecar({index: 0});
      vi.spyOn(network, "sendBlobSidecarsByRoot").mockResolvedValue([blobSidecar]);

      await downloadAndCacheData({
        config,
        network,
        executionEngine,
        blockInput,
        peerIdStr,
      });

      expect(executionEngine.getBlobs).toHaveBeenCalled();
      expect(network.sendBlobSidecarsByRoot).toHaveBeenCalled();
      expect(blockInput.hasAllData()).toBe(true);
    });

    it("should throw for non-blob block input", async () => {
      const blockInput = 
      BlockInputPreData.createFromBlock({
        block: signedBeaconBlock,
        blockRootHex: blockRootHex,
        source: {
          source: BlockInputSource.gossip,
          seenTimestampSec: 0,
          peerIdStr: undefined
        },
        daOutOfRange: false,
        forkName: 
      });

      await expect(
        downloadAndCacheData({
          config,
          network,
          executionEngine,
          blockInput,
          peerIdStr,
        })
      ).rejects.toThrow(DownloadByRootError);
    });
  });
}
)

// // ---------------------------------------------------------------------------
// // Mock *everything* that would otherwise hit the network, disk, or complex
// // Lodestar internals – the goal is to exercise our own control‑flow and error
// // handling rather than Lodestar itself.
// // ---------------------------------------------------------------------------

// // Lodestar helpers we merely need stubs for
// vi.mock("@lodestar/state-transition", () => ({
//   // Only the function used by the code under test
//   signedBlockToSignedHeader: vi.fn(() => ({message: {slot: 0}})),
// }));

// vi.mock("../../util/blobs.js", () => ({
//   computeInclusionProof: vi.fn(() => new Uint8Array(32)),
// }));

// // Block‑input helpers.  We just need the enum/value holders so the real module
// // never loads.  Feel free to extend if you lean on additional helpers later.
// vi.mock("../../chain/blocks/blockInput/index.js", () => {
//   return {
//     DAType: {Blob: "blob", Other: "other"},
//     BlockInputSource: {byRoot: "byRoot", engine: "engine"},
//     // Used as a type‑guard in the code under test.  We keep it extremely
//     // simple: treat objects that expose getMissingBlobMeta as “blob” inputs.
//     isBlockInputBlobs: (bi: any) => typeof bi?.getMissingBlobMeta === "function",
//   };
// });

// // Pending‑input helpers – we only care that the exported predicate recognises
// // our handcrafted test doubles as “pending”.
// vi.mock("../types.js", () => ({
//   isPendingBlockInput: (p: any) => !!p?.blockInput,
//   getBlockInputSyncCacheItemRootHex: (pending: any) => pending.blockRootHex,
// }));

// // ---------------------------------------------------------------------------
// // Utility factories for repeatable, concise mock instances
// // ---------------------------------------------------------------------------

// type MockFns<B = unknown> = {
//   hasBlock: ReturnType<typeof vi.fn>;
//   addBlock: ReturnType<typeof vi.fn>;
//   hasAllData: ReturnType<typeof vi.fn>;
//   addBlob: ReturnType<typeof vi.fn>;
//   getMissingBlobMeta: ReturnType<typeof vi.fn>;
//   getBlock: ReturnType<typeof vi.fn>;
// } & B;

// function createMockBlockInput(opts?: {
//   hasBlock?: boolean;
//   hasAllData?: boolean;
//   missingMeta?: Array<{index: number; versionHash: Uint8Array; blockRoot: Uint8Array}>;
// }): [MockFns, any /* blob sidecar placeholder */] {
//   const {hasBlock = false, hasAllData = true, missingMeta = []} = opts ?? {};

//   const blobSidecar = {
//     index: 0,
//     blob: new Uint8Array([1, 2, 3]),
//     kzgProof: new Uint8Array(48),
//     kzgCommitment: new Uint8Array(48),
//     signedBlockHeader: {message: {slot: 0}},
//   };

//   const blockInput: any = {
//     type: "blob", // our mocked DAType.Blob
//     blockRootHex: "0xdeadbeef",
//     forkName: "capella",

//     // behaviour flags
//     hasBlock: vi.fn(() => hasBlock),
//     addBlock: vi.fn(),
//     hasAllData: vi.fn(() => hasAllData),
//     addBlob: vi.fn(),
//     getMissingBlobMeta: vi.fn(() => missingMeta),
//     getBlock: vi.fn(() => ({message: {body: {blobKzgCommitments: [new Uint8Array(48)]}}})),
//   } as MockFns;

//   return [blockInput, blobSidecar];
// }

// function createMockNetwork() {
//   return {
//     sendBeaconBlocksByRoot: vi.fn(),
//     sendBlobSidecarsByRoot: vi.fn(),
//   } as any;
// }

// function createMockExecutionEngine() {
//   return {
//     getBlobs: vi.fn(),
//   } as any;
// }

// function createMockConfig() {
//   return {
//     getForkTypes: vi.fn(() => ({
//       BeaconBlockHeader: {
//         hashTreeRoot: vi.fn(() => new Uint8Array(32)),
//       },
//     })),
//   } as any;
// }

// // ---------------------------------------------------------------------------
// // Test‑cases
// // ---------------------------------------------------------------------------

// describe("downloadBlockInputByRoot (happy‑paths)", () => {
//   let network: ReturnType<typeof createMockNetwork>;
//   let config: ReturnType<typeof createMockConfig>;
//   const peerId = "peer‑01";

//   beforeEach(() => {
//     network = createMockNetwork();
//     config = createMockConfig();
//   });

//   afterEach(() => vi.clearAllMocks());

//   it("downloads the block when the pending item has no block", async () => {
//     const [blockInput] = createMockBlockInput({hasBlock: false});

//     // Network returns exactly one block (shape doesn’t matter for this test)
//     const fakeBlock = {data: {message: {}}};
//     network.sendBeaconBlocksByRoot.mockResolvedValue([fakeBlock]);

//     const pending = {
//       status: "SYNCING",
//       blockInput,
//       blockRootHex: "0xdeadbeef",
//       timeAddedSec: Date.now(),
//       peerIdStrings: [],
//       timeSyncedSec: undefined,
//     };

//     const result = await downloadBlockInputByRoot({
//       config,
//       network,
//       cache: {getBlockInputByBlock: vi.fn()},
//       executionEngine: undefined,
//       pending,
//       peerIdStr: peerId,
//     });

//     expect(network.sendBeaconBlocksByRoot).toHaveBeenCalledTimes(1);
//     expect(blockInput.addBlock).toHaveBeenCalledTimes(1);
//     expect(result).toBe(pending); // same object back
//   });

//   it("skips all network calls when block and data are already present", async () => {
//     const [blockInput] = createMockBlockInput({hasBlock: true, hasAllData: true});

//     const pending = {
//       status: "SYNCING",
//       blockInput,
//       blockRootHex: "0xdeadbeef",
//       timeAddedSec: Date.now(),
//       peerIdStrings: [],
//       timeSyncedSec: undefined,
//     };

//     await downloadBlockInputByRoot({
//       config,
//       network,
//       cache: {getBlockInputByBlock: vi.fn()},
//       executionEngine: undefined,
//       pending,
//       peerIdStr: peerId,
//     });

//     expect(network.sendBeaconBlocksByRoot).not.toHaveBeenCalled();
//     expect(network.sendBlobSidecarsByRoot).not.toHaveBeenCalled();
//     expect(blockInput.addBlob).not.toHaveBeenCalled();
//   });
// });

// describe("downloadBlockInputByRoot – blob acquisition", () => {
//   let network: ReturnType<typeof createMockNetwork>;
//   let execEngine: ReturnType<typeof createMockExecutionEngine>;
//   let config: ReturnType<typeof createMockConfig>;
//   const peerId = "peer‑01";

//   beforeEach(() => {
//     network = createMockNetwork();
//     execEngine = createMockExecutionEngine();
//     config = createMockConfig();
//   });

//   afterEach(() => vi.clearAllMocks());

//   it("prefers the execution engine when it can supply all missing blobs", async () => {
//     const [blockInput] = createMockBlockInput({
//       hasBlock: true,
//       hasAllData: false,
//       missingMeta: [{index: 0, versionHash: new Uint8Array(32), blockRoot: new Uint8Array(32)}],
//     });

//     // EE can fully satisfy request
//     execEngine.getBlobs.mockResolvedValue([{blob: new Uint8Array(4), proof: new Uint8Array(48)}]);

//     const pending = {
//       status: "SYNCING",
//       blockInput,
//       blockRootHex: "0xdeadbeef",
//       timeAddedSec: Date.now(),
//       peerIdStrings: [],
//       timeSyncedSec: undefined,
//     };

//     await downloadBlockInputByRoot({
//       config,
//       network,
//       cache: {getBlockInputByBlock: vi.fn()},
//       executionEngine: execEngine,
//       pending,
//       peerIdStr: peerId,
//     });

//     expect(execEngine.getBlobs).toHaveBeenCalledTimes(1);
//     expect(blockInput.addBlob).toHaveBeenCalledTimes(1);
//     // Since EE managed, the network should NOT have been queried for blobs
//     expect(network.sendBlobSidecarsByRoot).not.toHaveBeenCalled();
//   });

//   it("falls back to peers for blob sidecars when EE cannot supply", async () => {
//     const missingMeta = [{index: 0, versionHash: new Uint8Array(32), blockRoot: new Uint8Array(32)}];
//     const [blockInput] = createMockBlockInput({
//       hasBlock: true,
//       hasAllData: false,
//       missingMeta,
//     });

//     execEngine.getBlobs.mockResolvedValue([undefined]);
//     network.sendBlobSidecarsByRoot.mockResolvedValue([
//       {
//         index: 0,
//         blob: new Uint8Array(4),
//         kzgProof: new Uint8Array(48),
//         kzgCommitment: new Uint8Array(48),
//         signedBlockHeader: {message: {slot: 0}},
//       },
//     ]);

//     const pending = {
//       status: "SYNCING",
//       blockInput,
//       blockRootHex: "0xdeadbeef",
//       timeAddedSec: Date.now(),
//       peerIdStrings: [],
//       timeSyncedSec: undefined,
//     };

//     await downloadBlockInputByRoot({
//       config,
//       network,
//       cache: {getBlockInputByBlock: vi.fn()},
//       executionEngine: execEngine,
//       pending,
//       peerIdStr: peerId,
//     });

//     expect(execEngine.getBlobs).toHaveBeenCalledTimes(1);
//     expect(network.sendBlobSidecarsByRoot).toHaveBeenCalledTimes(1);
//     expect(blockInput.addBlob).toHaveBeenCalledTimes(1);
//   });
// });

// describe("downloadAndCacheData – error handling", () => {
//   it("throws when given a non‑blob blockInput", async () => {
//     const blockInput: any = {
//       type: "other", // not recognised as blob by our isBlockInputBlobs mock
//       blockRootHex: "0x00",
//       hasAllData: () => true,
//     };

//     // Dummy args
//     const args = {
//       config: createMockConfig(),
//       network: createMockNetwork(),
//       executionEngine: undefined,
//       blockInput,
//       peerIdStr: "peer‑01",
//     } as any;

//     await expect(downloadAndCacheData(args)).rejects.toEqual(
//       new DownloadByRootError({
//         code: DownloadByRootErrorCode.INVALID_BLOCK_INPUT_TYPE,
//         blockRoot: "0x00",
//         type: "other",
//       })
//     );
//   });
// });
