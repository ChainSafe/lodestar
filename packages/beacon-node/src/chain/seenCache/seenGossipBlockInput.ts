import {deneb, RootHex, SignedBeaconBlock, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {pruneSetToMax, toRootHex} from "@lodestar/utils";
import {BLOBSIDECAR_FIXED_SIZE, isForkBlobs, ForkName} from "@lodestar/params";

import {
  BlockInput,
  NullBlockInput,
  getBlockInput,
  BlockSource,
  BlockInputDataBlobs,
  CachedData,
  GossipedInputType,
  getBlockInputBlobs,
  BlobsSource,
} from "../blocks/types.js";
import {Metrics} from "../../metrics/index.js";

export enum BlockInputAvailabilitySource {
  GOSSIP = "gossip",
  UNKNOWN_SYNC = "unknown_sync",
}

type GossipedBlockInput =
  | {type: GossipedInputType.block; signedBlock: SignedBeaconBlock; blockBytes: Uint8Array | null}
  | {type: GossipedInputType.blob; blobSidecar: deneb.BlobSidecar; blobBytes: Uint8Array | null};

type BlockInputCacheType = {
  fork: ForkName;
  block?: SignedBeaconBlock;
  blockBytes?: Uint8Array | null;
  cachedData?: CachedData;
  // block promise and its callback cached for delayed resolution
  blockInputPromise: Promise<BlockInput>;
  resolveBlockInput: (blockInput: BlockInput) => void;
};

const MAX_GOSSIPINPUT_CACHE = 5;

/**
 * For predeneb, SeenGossipBlockInput only tracks and caches block so that we don't need to download known block
 * roots. From deneb, it serves same purpose plus tracks and caches the live blobs and blocks on the network to
 * solve data availability for the blockInput. If no block has been seen yet for some already seen blobs, it
 * responds will null, but on the first block or the consequent blobs it responds with blobs promise till all blobs
 * become available.
 *
 * One can start processing block on blobs promise blockInput response and can await on the promise before
 * fully importing the block. The blobs promise is gets resolved as soon as all blobs corresponding to that
 * block are seen by SeenGossipBlockInput
 */
export class SeenGossipBlockInput {
  private blockInputCache = new Map<RootHex, BlockInputCacheType>();

  prune(): void {
    pruneSetToMax(this.blockInputCache, MAX_GOSSIPINPUT_CACHE);
  }

  hasBlock(blockRoot: RootHex): boolean {
    return this.blockInputCache.has(blockRoot);
  }

  getGossipBlockInput(
    config: ChainForkConfig,
    gossipedInput: GossipedBlockInput,
    metrics: Metrics | null
  ):
    | {
        blockInput: BlockInput;
        blockInputMeta: {pending: GossipedInputType.blob | null; haveBlobs: number; expectedBlobs: number};
      }
    | {
        blockInput: NullBlockInput;
        blockInputMeta: {pending: GossipedInputType.block; haveBlobs: number; expectedBlobs: null};
      } {
    let blockHex;
    let blockCache;
    let fork;

    if (gossipedInput.type === GossipedInputType.block) {
      const {signedBlock, blockBytes} = gossipedInput;
      fork = config.getForkName(signedBlock.message.slot);

      blockHex = toRootHex(config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message));
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork);

      blockCache.block = signedBlock;
      blockCache.blockBytes = blockBytes;
    } else {
      const {blobSidecar, blobBytes} = gossipedInput;
      const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
      fork = config.getForkName(blobSidecar.signedBlockHeader.message.slot);

      blockHex = toRootHex(blockRoot);
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork);

      // TODO: freetheblobs check if its the same blob or a duplicate and throw/take actions
      blockCache.cachedData?.blobsCache.set(blobSidecar.index, {
        blobSidecar,
        // easily splice out the unsigned message as blob is a fixed length type
        blobBytes: blobBytes?.slice(0, BLOBSIDECAR_FIXED_SIZE) ?? null,
      });
    }

    if (!this.blockInputCache.has(blockHex)) {
      this.blockInputCache.set(blockHex, blockCache);
    }

    const {block: signedBlock, blockBytes, blockInputPromise, resolveBlockInput, cachedData} = blockCache;

    if (signedBlock !== undefined) {
      if (!isForkBlobs(fork)) {
        return {
          blockInput: getBlockInput.preData(config, signedBlock, BlockSource.gossip, blockBytes ?? null),
          blockInputMeta: {pending: null, haveBlobs: 0, expectedBlobs: 0},
        };
      }

      if (cachedData === undefined || !isForkBlobs(cachedData.fork)) {
        throw Error("Missing or Invalid fork cached Data for deneb+ block");
      }
      const {blobsCache, resolveAvailability} = cachedData;

      // block is available, check if all blobs have shown up
      const {slot, body} = signedBlock.message;
      const {blobKzgCommitments} = body as deneb.BeaconBlockBody;
      const blockInfo = `blockHex=${blockHex}, slot=${slot}`;

      if (blobKzgCommitments.length < blobsCache.size) {
        throw Error(
          `Received more blobs=${blobsCache.size} than commitments=${blobKzgCommitments.length} for ${blockInfo}`
        );
      }

      if (blobKzgCommitments.length === blobsCache.size) {
        const allBlobs = getBlockInputBlobs(blobsCache);
        const blockData = {...allBlobs, blobsSource: BlobsSource.gossip, fork: cachedData.fork};
        resolveAvailability(blockData);
        metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});
        const blockInput = getBlockInput.availableData(
          config,
          signedBlock,
          BlockSource.gossip,
          blockBytes ?? null,
          blockData
        );

        resolveBlockInput(blockInput);
        return {
          blockInput,
          blockInputMeta: {pending: null, haveBlobs: allBlobs.blobs.length, expectedBlobs: blobKzgCommitments.length},
        };
      }

      const blockInput = getBlockInput.dataPromise(
        config,
        signedBlock,
        BlockSource.gossip,
        blockBytes ?? null,
        cachedData
      );

      resolveBlockInput(blockInput);
      return {
        blockInput,
        blockInputMeta: {
          pending: GossipedInputType.blob,
          haveBlobs: blobsCache.size,
          expectedBlobs: blobKzgCommitments.length,
        },
      };
    }

    // will need to wait for the block to showup
    if (cachedData === undefined) {
      throw Error("Missing cachedData for deneb+ blobs");
    }
    const {blobsCache} = cachedData;

    return {
      blockInput: {
        block: null,
        blockRootHex: blockHex,
        cachedData,
        blockInputPromise,
      },
      blockInputMeta: {pending: GossipedInputType.block, haveBlobs: blobsCache.size, expectedBlobs: null},
    };
  }
}

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
