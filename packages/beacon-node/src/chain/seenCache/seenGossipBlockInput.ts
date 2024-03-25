import {toHexString} from "@chainsafe/ssz";
import {deneb, electra, RootHex, ssz, allForks} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {pruneSetToMax} from "@lodestar/utils";
import {BLOBSIDECAR_FIXED_SIZE, ForkName, isForkBlobs, isForkILs} from "@lodestar/params";

import {
  BlockInput,
  NullBlockInput,
  getBlockInput,
  BlockSource,
  BlockInputDataBlobs,
  CachedData,
  GossipedInputType,
  getBlockInputBlobs,
  BlockInputDataIls,
  BlockInputILType,
} from "../blocks/types.js";
import {Metrics} from "../../metrics/index.js";

export enum BlockInputAvailabilitySource {
  GOSSIP = "gossip",
  UNKNOWN_SYNC = "unknown_sync",
}

type GossipedBlockInput =
  | {type: GossipedInputType.block; signedBlock: allForks.SignedBeaconBlock; blockBytes: Uint8Array | null}
  | {type: GossipedInputType.blob; blobSidecar: deneb.BlobSidecar; blobBytes: Uint8Array | null}
  | {
      type: GossipedInputType.ilist;
      signedInclusionList: electra.SignedInclusionList;
      inclusionListBytes: Uint8Array | null;
    };

type BlockInputCacheType = {
  fork: ForkName;
  block?: allForks.SignedBeaconBlock;
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
  private seenILsByParentHash = new Map<RootHex, electra.SignedInclusionList>();
  private blockInputRootByParentHash = new Map<RootHex, RootHex>();

  prune(): void {
    pruneSetToMax(this.blockInputCache, MAX_GOSSIPINPUT_CACHE);
    pruneSetToMax(this.seenILsByParentHash, MAX_GOSSIPINPUT_CACHE);
    pruneSetToMax(this.blockInputRootByParentHash, MAX_GOSSIPINPUT_CACHE);
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
        blockInputMeta: {
          pending: GossipedInputType.blob | GossipedInputType.ilist | null;
          haveBlobs: number;
          expectedBlobs: number;
        };
      }
    | {
        blockInput: NullBlockInput;
        blockInputMeta: {pending: GossipedInputType.block; haveBlobs: number; expectedBlobs: null};
      }
    | null {
    let blockHex;
    let blockCache;
    let fork;

    if (gossipedInput.type === GossipedInputType.ilist) {
      const {signedInclusionList} = gossipedInput;
      const parentBlockHashHex = toHexString(signedInclusionList.message.signedSummary.message.parentHash);
      this.seenILsByParentHash.set(parentBlockHashHex, signedInclusionList);

      blockHex = this.blockInputRootByParentHash.get(parentBlockHashHex);
      blockCache = blockHex ? this.blockInputCache.get(blockHex) : undefined;
      if (blockHex === undefined || blockCache === undefined) {
        return null;
      }
      fork = blockCache.fork;
    } else if (gossipedInput.type === GossipedInputType.block) {
      const {signedBlock, blockBytes} = gossipedInput;
      fork = config.getForkName(signedBlock.message.slot);

      blockHex = toHexString(
        config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry(fork);

      blockCache.block = signedBlock;
      blockCache.blockBytes = blockBytes;
    } else {
      const {blobSidecar, blobBytes} = gossipedInput;
      const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
      fork = config.getForkName(blobSidecar.signedBlockHeader.message.slot);

      blockHex = toHexString(blockRoot);
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
          blockInput: getBlockInput.preDeneb(config, signedBlock, BlockSource.gossip, blockBytes ?? null),
          blockInputMeta: {pending: null, haveBlobs: 0, expectedBlobs: 0},
        };
      }

      if (cachedData === undefined || !isForkBlobs(cachedData.fork)) {
        throw Error("Missing or Invalid fork cached Data for deneb+ block");
      }
      const {blobsCache} = cachedData;

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
        const {blobs} = allBlobs;
        let blockInput;

        let blockData;
        if (cachedData.fork === ForkName.deneb) {
          blockData = {fork: cachedData.fork, ...allBlobs} as BlockInputDataBlobs;
          cachedData.resolveAvailability(blockData);
        } else {
          const parentBlockHash = toHexString(
            (signedBlock as electra.SignedBeaconBlock).message.body.executionPayload.parentHash
          );
          const signedIL = this.seenILsByParentHash.get(parentBlockHash);
          if (signedIL === undefined) {
            blockData = {fork: cachedData.fork, ...allBlobs, ilType: BlockInputILType.syncing} as BlockInputDataIls;
          } else {
            blockData = {
              fork: cachedData.fork,
              ...allBlobs,
              ilType: BlockInputILType.actualIL,
              inclusionList: signedIL.message,
            } as BlockInputDataIls;
            cachedData.resolveAvailability(blockData);
          }
        }

        metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});
        blockInput = getBlockInput.postDeneb(config, signedBlock, blockBytes ?? null, blockData, BlockSource.gossip);

        resolveBlockInput(blockInput);
        return {
          blockInput,
          blockInputMeta: {
            pending: GossipedInputType.ilist,
            haveBlobs: blobsCache.size,
            expectedBlobs: blobKzgCommitments.length,
          },
        };
      } else {
        const blockInput = getBlockInput.blobsPromise(
          config,
          signedBlock,
          blockBytes ?? null,
          cachedData,
          BlockSource.gossip
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
    } else {
      if (cachedData === undefined) {
        throw Error("Missing cachedData for deneb+ blobs");
      }
      const {blobsCache} = cachedData;

      // will need to wait for the block to showup
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
  const blobsCache = new Map();

  if (!isForkILs(fork)) {
    // blobs availability
    let resolveAvailability: ((blobs: BlockInputDataBlobs) => void) | null = null;
    const availabilityPromise = new Promise<BlockInputDataBlobs>((resolveCB) => {
      resolveAvailability = resolveCB;
    });

    if (resolveAvailability === null) {
      throw Error("Promise Constructor was not executed immediately");
    }
    const cachedData: CachedData = {fork, blobsCache, availabilityPromise, resolveAvailability};
    return {fork, blockInputPromise, resolveBlockInput, cachedData};
  } else {
    // il availability (with blobs)
    let resolveAvailability: ((blobs: BlockInputDataIls) => void) | null = null;
    const availabilityPromise = new Promise<BlockInputDataIls>((resolveCB) => {
      resolveAvailability = resolveCB;
    });

    if (resolveAvailability === null) {
      throw Error("Promise Constructor was not executed immediately");
    }
    const cachedData: CachedData = {fork, blobsCache, availabilityPromise, resolveAvailability};
    return {fork, blockInputPromise, resolveBlockInput, cachedData};
  }
}
