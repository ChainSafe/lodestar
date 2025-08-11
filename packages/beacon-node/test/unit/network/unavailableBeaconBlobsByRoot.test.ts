import {toHexString} from "@chainsafe/ssz";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {BYTES_PER_FIELD_ELEMENT, FIELD_ELEMENTS_PER_BLOB, ForkName} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {deneb, fulu, ssz} from "@lodestar/types";
import {describe, expect, it, vi} from "vitest";
import {
  BlobsSource,
  BlockInput,
  BlockInputAvailableData,
  BlockInputType,
  BlockSource,
  CachedData,
  getBlockInput,
} from "../../../src/chain/blocks/types.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {getEmptyBlockInputCacheEntry} from "../../../src/chain/seenCache/seenGossipBlockInput.js";
import {IExecutionEngine} from "../../../src/execution/index.js";
import {INetwork} from "../../../src/network/interface.js";
import {unavailableBeaconBlobsByRoot} from "../../../src/network/reqresp/index.js";
import {computeNodeId} from "../../../src/network/subnets/index.js";
import {
  computeInclusionProof,
  computeKzgCommitmentsInclusionProof,
  kzgCommitmentToVersionedHash,
} from "../../../src/util/blobs.js";
import {CustodyConfig, getDataColumnSidecars} from "../../../src/util/dataColumns.js";
import {kzg} from "../../../src/util/kzg.js";
import {getValidPeerId} from "../../utils/peer.js";

describe("unavailableBeaconBlobsByRoot", () => {
  describe("blobs", () => {
    const chainConfig = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
    });
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    const executionEngine = {
      getBlobs: vi.fn(),
    };

    const network = {
      sendBeaconBlocksByRoot: vi.fn(),
      sendBlobSidecarsByRoot: vi.fn(),
    };

    const peerId = "mockPeerId";
    const engineGetBlobsCache = new Map();

    it("should successfully resolve all blobs from engine and network", async () => {
      // Simulate a block 1 with 5 blobs
      const signedBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = 1;
      const blobscommitmentsandproofs = generateBlobs(5);
      signedBlock.message.body.blobKzgCommitments.push(...blobscommitmentsandproofs.kzgCommitments);
      const blockheader = signedBlockToSignedHeader(config, signedBlock);

      const unavailableBlockInput = {
        block: signedBlock,
        source: BlockSource.gossip,
        blockBytes: null,
        type: BlockInputType.dataPromise,
        cachedData: getEmptyBlockInputCacheEntry(ForkName.deneb, 1).cachedData,
      } as BlockInput;

      // total of 5 blobs
      //  blob 0. not in cache & to resolved by getBlobs
      //  blob 1. not in cache & to resolved by getBlobs
      //  blob 2. to be found in engineGetBlobsCache
      //  blob 3. null cached earlier so should directly go to network query and skip engine query
      //  blob 4. to hit getBlobs first with null response and then go to the network query
      //
      //  engineGetBlobsCache caches 2 fully, and null for 3
      //  getBlobs should see 0,1,4 and return first two non null and last null
      //  network should see 3,4

      engineGetBlobsCache.set(toHexString(blobscommitmentsandproofs.blobVersionedHashes[2]), {
        blob: blobscommitmentsandproofs.blobs[2],
        proof: blobscommitmentsandproofs.kzgProofs[2],
      });
      engineGetBlobsCache.set(toHexString(blobscommitmentsandproofs.blobVersionedHashes[3]), null);

      // Mock execution engine to return 2 blobs
      executionEngine.getBlobs.mockResolvedValueOnce([
        {
          blob: blobscommitmentsandproofs.blobs[0],
          proof: blobscommitmentsandproofs.kzgProofs[0],
        },
        {
          blob: blobscommitmentsandproofs.blobs[1],
          proof: blobscommitmentsandproofs.kzgProofs[1],
        },
        null,
      ]);

      // Mock network to return 2 blobs
      network.sendBlobSidecarsByRoot.mockResolvedValueOnce([
        {
          index: 3,
          blob: blobscommitmentsandproofs.blobs[3],
          kzgCommitment: blobscommitmentsandproofs.kzgCommitments[3],
          kzgProof: blobscommitmentsandproofs.kzgProofs[3],
          signedBlockHeader: blockheader,
          kzgCommitmentInclusionProof: computeInclusionProof(ForkName.deneb, signedBlock.message.body, 3),
        },
        {
          index: 4,
          blob: blobscommitmentsandproofs.blobs[4],
          kzgCommitment: blobscommitmentsandproofs.kzgCommitments[4],
          kzgProof: blobscommitmentsandproofs.kzgProofs[4],
          signedBlockHeader: blockheader,
          kzgCommitmentInclusionProof: computeInclusionProof(ForkName.deneb, signedBlock.message.body, 4),
        },
      ]);

      const result = await unavailableBeaconBlobsByRoot(
        config,
        network as unknown as INetwork,
        peerId,
        "peerClient",
        unavailableBlockInput,
        {
          executionEngine: executionEngine as unknown as IExecutionEngine,
          emitter: new ChainEventEmitter(),
          engineGetBlobsCache,
        }
      );

      // Check if all blobs are aggregated
      const allBlobs = [
        {
          index: 0,
          blob: blobscommitmentsandproofs.blobs[0],
          kzgCommitment: blobscommitmentsandproofs.kzgCommitments[0],
          kzgProof: blobscommitmentsandproofs.kzgProofs[0],
          signedBlockHeader: blockheader,
          kzgCommitmentInclusionProof: computeInclusionProof(ForkName.deneb, signedBlock.message.body, 0),
        },
        {
          index: 1,
          blob: blobscommitmentsandproofs.blobs[1],
          kzgCommitment: blobscommitmentsandproofs.kzgCommitments[1],
          kzgProof: blobscommitmentsandproofs.kzgProofs[1],
          signedBlockHeader: blockheader,
          kzgCommitmentInclusionProof: computeInclusionProof(ForkName.deneb, signedBlock.message.body, 1),
        },
        {
          index: 2,
          blob: blobscommitmentsandproofs.blobs[2],
          kzgCommitment: blobscommitmentsandproofs.kzgCommitments[2],
          kzgProof: blobscommitmentsandproofs.kzgProofs[2],
          signedBlockHeader: blockheader,
          kzgCommitmentInclusionProof: computeInclusionProof(ForkName.deneb, signedBlock.message.body, 2),
        },
        {
          index: 3,
          blob: blobscommitmentsandproofs.blobs[3],
          kzgCommitment: blobscommitmentsandproofs.kzgCommitments[3],
          kzgProof: blobscommitmentsandproofs.kzgProofs[3],
          signedBlockHeader: blockheader,
          kzgCommitmentInclusionProof: computeInclusionProof(ForkName.deneb, signedBlock.message.body, 3),
        },
        {
          index: 4,
          blob: blobscommitmentsandproofs.blobs[4],
          kzgCommitment: blobscommitmentsandproofs.kzgCommitments[4],
          kzgProof: blobscommitmentsandproofs.kzgProofs[4],
          signedBlockHeader: blockheader,
          kzgCommitmentInclusionProof: computeInclusionProof(ForkName.deneb, signedBlock.message.body, 4),
        },
      ];

      const blockData: BlockInputAvailableData = {
        fork: ForkName.deneb,
        blobs: allBlobs,
        blobsSource: BlobsSource.byRoot,
      };
      const resolvedBlobs = getBlockInput.availableData(config, signedBlock, BlockSource.byRoot, blockData);

      const engineReqIdentifiers = [...blobscommitmentsandproofs.blobVersionedHashes];
      // versionedHashes: 1,2,4
      engineReqIdentifiers.splice(2, 2);
      expect(result).toBeDefined();
      expect(executionEngine.getBlobs).toHaveBeenCalledWith("deneb", engineReqIdentifiers);
      expect(result).toEqual(resolvedBlobs);
    });
  });

  describe("data columns", () => {
    const chainConfig = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
    });
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    const executionEngine = {
      getBlobs: vi.fn(),
    };

    const network = {
      sendBeaconBlocksByRoot: vi.fn(),
      sendBlobSidecarsByRoot: vi.fn(),
      custodyConfig: new CustodyConfig({
        nodeId: computeNodeId(getValidPeerId()),
        config,
      }),
    };

    const peerId = "mockPeerId";
    const engineGetBlobsCache = new Map();

    it("should successfully resolve all data columns from engine", async () => {
      // Simulate a block 1 with 3 blobs
      const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = 1;
      const blobscommitmentsandproofs = generateBlobsWithCellProofs(3);
      signedBlock.message.body.blobKzgCommitments.push(...blobscommitmentsandproofs.map((b) => b.kzgCommitment));
      const blockheader = signedBlockToSignedHeader(config, signedBlock);

      const unavailableBlockInput: BlockInput = {
        block: signedBlock,
        source: BlockSource.gossip,
        type: BlockInputType.dataPromise,
        cachedData: getEmptyBlockInputCacheEntry(ForkName.fulu, 1).cachedData as CachedData,
      };

      const blobAndProof: fulu.BlobAndProofV2[] = blobscommitmentsandproofs.map((b) => ({
        blob: b.blob,
        proofs: b.cellsAndProofs.proofs,
      }));

      // Mock execution engine to return all blobs
      executionEngine.getBlobs.mockImplementationOnce(
        (): Promise<fulu.BlobAndProofV2[] | null> => Promise.resolve(blobAndProof)
      );

      const result = await unavailableBeaconBlobsByRoot(
        config,
        network as unknown as INetwork,
        peerId,
        "peerClient",
        unavailableBlockInput,
        {
          executionEngine: executionEngine as unknown as IExecutionEngine,
          emitter: new ChainEventEmitter(),
          engineGetBlobsCache,
        }
      );

      const sampledSidecars = getDataColumnSidecars(
        blockheader,
        blobscommitmentsandproofs.map((b) => b.kzgCommitment),
        computeKzgCommitmentsInclusionProof(ForkName.fulu, signedBlock.message.body),
        blobscommitmentsandproofs.map((b) => b.cellsAndProofs)
      ).filter((s) => network.custodyConfig.sampledColumns.includes(s.index));

      expect(executionEngine.getBlobs).toHaveBeenCalledWith(
        ForkName.fulu,
        blobscommitmentsandproofs.map((b) => kzgCommitmentToVersionedHash(b.kzgCommitment))
      );
      expect(result.type).toEqual(BlockInputType.availableData);
      if (result.type !== BlockInputType.availableData) throw new Error("Should not get here");
      expect(result.blockData.fork).toEqual(ForkName.fulu);
      if (result.blockData.fork !== ForkName.fulu) throw new Error("Should not get here");
      expect(result.blockData.dataColumns).toEqual(sampledSidecars);
    });
  });
});

function generateBlobs(count: number): {
  blobs: Uint8Array[];
  kzgCommitments: Uint8Array[];
  blobVersionedHashes: Uint8Array[];
  kzgProofs: Uint8Array[];
} {
  const blobs = Array.from({length: count}, (_, index) => generateRandomBlob(index));
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  const versionedHash = kzgCommitments.map((kzgCommitment) => kzgCommitmentToVersionedHash(kzgCommitment));
  const kzgProofs = blobs.map((blob, index) => kzg.computeBlobKzgProof(blob, kzgCommitments[index]));

  return {
    blobs,
    kzgCommitments,
    blobVersionedHashes: versionedHash.map((hash) => hash),
    kzgProofs,
  };
}

function generateBlobsWithCellProofs(
  count: number
): {blob: Uint8Array; cellsAndProofs: {cells: Uint8Array[]; proofs: Uint8Array[]}; kzgCommitment: Uint8Array}[] {
  const blobs = Array.from({length: count}, (_, index) => generateRandomBlob(index));

  return blobs.map((blob) => ({
    blob,
    cellsAndProofs: kzg.computeCellsAndKzgProofs(blob),
    kzgCommitment: kzg.blobToKzgCommitment(blob),
  }));
}

function generateRandomBlob(index: number): deneb.Blob {
  const blob = new Uint8Array(FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);

  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB; i++) {
    // Generate a unique value based on the index
    dv.setUint32(i * BYTES_PER_FIELD_ELEMENT, index + i);
  }
  return blob;
}
