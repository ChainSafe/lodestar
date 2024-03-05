import {toHexString} from "@chainsafe/ssz";
import {deneb, RootHex, ssz, allForks} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {pruneSetToMax} from "@lodestar/utils";
import {BLOBSIDECAR_FIXED_SIZE, ForkSeq} from "@lodestar/params";

import {
  BlockInput,
  getBlockInput,
  BlockSource,
  BlockInputBlobs,
  BlobsCache,
  GossipedInputType,
  getBlockInputBlobs,
} from "../blocks/types.js";
import {Metrics} from "../../metrics/index.js";

export enum BlockInputAvailabilitySource {
  GOSSIP = "gossip",
  UNKNOWN_SYNC = "unknown_sync",
}

type GossipedBlockInput =
  | {type: GossipedInputType.block; signedBlock: allForks.SignedBeaconBlock; blockBytes: Uint8Array | null}
  | {type: GossipedInputType.blob; blobSidecar: deneb.BlobSidecar; blobBytes: Uint8Array | null};

type BlockInputCacheType = {
  block?: allForks.SignedBeaconBlock;
  blockBytes?: Uint8Array | null;
  blobsCache: BlobsCache;
  // promise and its callback cached for delayed resolution
  availabilityPromise: Promise<BlockInputBlobs>;
  resolveAvailability: (blobs: BlockInputBlobs) => void;
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
    | {blockInput: null; blockInputMeta: {pending: GossipedInputType.block; haveBlobs: number; expectedBlobs: null}} {
    let blockHex;
    let blockCache;

    if (gossipedInput.type === GossipedInputType.block) {
      const {signedBlock, blockBytes} = gossipedInput;

      blockHex = toHexString(
        config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry();

      blockCache.block = signedBlock;
      blockCache.blockBytes = blockBytes;
    } else {
      const {blobSidecar, blobBytes} = gossipedInput;
      const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
      blockHex = toHexString(blockRoot);
      blockCache = this.blockInputCache.get(blockHex) ?? getEmptyBlockInputCacheEntry();

      // TODO: freetheblobs check if its the same blob or a duplicate and throw/take actions
      blockCache.blobsCache.set(blobSidecar.index, {
        blobSidecar,
        // easily splice out the unsigned message as blob is a fixed length type
        blobBytes: blobBytes?.slice(0, BLOBSIDECAR_FIXED_SIZE) ?? null,
      });
    }

    if (!this.blockInputCache.has(blockHex)) {
      this.blockInputCache.set(blockHex, blockCache);
    }

    const {block: signedBlock, blockBytes, blobsCache, availabilityPromise, resolveAvailability} = blockCache;

    if (signedBlock !== undefined) {
      if (config.getForkSeq(signedBlock.message.slot) < ForkSeq.deneb) {
        return {
          blockInput: getBlockInput.preDeneb(config, signedBlock, BlockSource.gossip, blockBytes ?? null),
          blockInputMeta: {pending: null, haveBlobs: 0, expectedBlobs: 0},
        };
      }
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
        resolveAvailability(allBlobs);
        metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.GOSSIP});
        const {blobs, blobsBytes} = allBlobs;
        return {
          blockInput: getBlockInput.postDeneb(
            config,
            signedBlock,
            BlockSource.gossip,
            blobs,
            blockBytes ?? null,
            blobsBytes
          ),
          blockInputMeta: {pending: null, haveBlobs: blobs.length, expectedBlobs: blobKzgCommitments.length},
        };
      } else {
        return {
          blockInput: getBlockInput.blobsPromise(
            config,
            signedBlock,
            BlockSource.gossip,
            blobsCache,
            blockBytes ?? null,
            availabilityPromise,
            resolveAvailability
          ),
          blockInputMeta: {
            pending: GossipedInputType.blob,
            haveBlobs: blobsCache.size,
            expectedBlobs: blobKzgCommitments.length,
          },
        };
      }
    } else {
      // will need to wait for the block to showup
      return {
        blockInput: null,
        blockInputMeta: {pending: GossipedInputType.block, haveBlobs: blobsCache.size, expectedBlobs: null},
      };
    }
  }
}

function getEmptyBlockInputCacheEntry(): BlockInputCacheType {
  // Capture both the promise and its callbacks.
  // It is not spec'ed but in tests in Firefox and NodeJS the promise constructor is run immediately
  let resolveAvailability: ((blobs: BlockInputBlobs) => void) | null = null;
  const availabilityPromise = new Promise<BlockInputBlobs>((resolveCB) => {
    resolveAvailability = resolveCB;
  });
  if (resolveAvailability === null) {
    throw Error("Promise Constructor was not executed immediately");
  }
  const blobsCache = new Map();
  return {availabilityPromise, resolveAvailability, blobsCache};
}
