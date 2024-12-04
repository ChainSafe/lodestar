import {toHexString} from "@chainsafe/ssz";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {BYTES_PER_FIELD_ELEMENT, FIELD_ELEMENTS_PER_BLOB, ForkBlobs, ForkName, isForkBlobs} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {SignedBeaconBlock, deneb, ssz} from "@lodestar/types";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {
  BlobsSource,
  BlockInput,
  BlockInputDataBlobs,
  BlockInputType,
  BlockSource,
  CachedData,
  getBlockInput,
} from "../../../src/chain/blocks/types.js";
import {IExecutionEngine} from "../../../src/execution/index.js";
import {INetwork} from "../../../src/network/interface.js";
import {unavailableBeaconBlobsByRoot} from "../../../src/network/reqresp/index.js";
import {computeInclusionProof, kzgCommitmentToVersionedHash} from "../../../src/util/blobs.js";
import {ckzg} from "../../../src/util/kzg.js";
import {initCKZG, loadEthereumTrustedSetup} from "../../../src/util/kzg.js";

describe("unavailableBeaconBlobsByRoot", () => {
  beforeAll(async () => {
    await initCKZG();
    loadEthereumTrustedSetup();
  });

  /* eslint-disable @typescript-eslint/naming-convention */
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
      cachedData: getEmptyBlockInputCacheEntry(ForkName.deneb).cachedData,
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
      unavailableBlockInput,
      {
        executionEngine: executionEngine as unknown as IExecutionEngine,
        metrics: null,
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

    const blockData = {
      fork: ForkName.deneb as ForkBlobs,
      blobs: allBlobs,
      blobsBytes: [null, null, null, null, null],
      blobsSource: BlobsSource.byRoot,
    };
    const resolvedBlobs = getBlockInput.availableData(config, signedBlock, BlockSource.byRoot, null, blockData);

    const engineReqIdentifiers = [...blobscommitmentsandproofs.blobVersionedHashes];
    // versionedHashes: 1,2,4
    engineReqIdentifiers.splice(2, 2);
    expect(result).toBeDefined();
    expect(executionEngine.getBlobs).toHaveBeenCalledWith("deneb", engineReqIdentifiers);
    expect(result).toEqual(resolvedBlobs);
  });
});

type BlockInputCacheType = {
  fork: ForkName;
  block?: SignedBeaconBlock;
  blockBytes?: Uint8Array | null;
  cachedData?: CachedData;
  // block promise and its callback cached for delayed resolution
  blockInputPromise: Promise<BlockInput>;
  resolveBlockInput: (blockInput: BlockInput) => void;
};

function getEmptyBlockInputCacheEntry(fork: ForkName): BlockInputCacheType {
  // Capture both the promise and its callbacks for blockInput and final availability
  // It is not spec'ed but in tests in Firefox and NodeJS the promise constructor is run immediately
  let resolveBlockInput: ((block: BlockInput) => void) | null = null;
  const blockInputPromise = new Promise<BlockInput>((resolveCB) => {
    resolveBlockInput = resolveCB;
  });
  if (resolveBlockInput === null) {
    throw Error("Promise Constructor was not executed immediately");
  }
  if (!isForkBlobs(fork)) {
    return {fork, blockInputPromise, resolveBlockInput};
  }

  let resolveAvailability: ((blobs: BlockInputDataBlobs) => void) | null = null;
  const availabilityPromise = new Promise<BlockInputDataBlobs>((resolveCB) => {
    resolveAvailability = resolveCB;
  });

  if (resolveAvailability === null) {
    throw Error("Promise Constructor was not executed immediately");
  }

  const blobsCache = new Map();
  const cachedData: CachedData = {fork, blobsCache, availabilityPromise, resolveAvailability};
  return {fork, blockInputPromise, resolveBlockInput, cachedData};
}

function generateBlobs(count: number): {
  blobs: Uint8Array[];
  kzgCommitments: Uint8Array[];
  blobVersionedHashes: Uint8Array[];
  kzgProofs: Uint8Array[];
} {
  const blobs = Array.from({length: count}, (_, index) => generateRandomBlob(index));
  const kzgCommitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
  const versionedHash = kzgCommitments.map((kzgCommitment) => kzgCommitmentToVersionedHash(kzgCommitment));
  const kzgProofs = blobs.map((blob, index) => ckzg.computeBlobKzgProof(blob, kzgCommitments[index]));

  return {
    blobs,
    kzgCommitments,
    blobVersionedHashes: versionedHash.map((hash) => hash),
    kzgProofs,
  };
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
