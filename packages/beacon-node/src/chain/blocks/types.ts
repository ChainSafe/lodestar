import {toHexString} from "@chainsafe/ssz";
import {CachedBeaconStateAllForks, computeEpochAtSlot, DataAvailableStatus} from "@lodestar/state-transition";
import {MaybeValidExecutionStatus} from "@lodestar/fork-choice";
import {allForks, deneb, Slot, RootHex} from "@lodestar/types";
import {ForkSeq, MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {pruneSetToMax} from "@lodestar/utils";

export enum BlockInputType {
  preDeneb = "preDeneb",
  postDeneb = "postDeneb",
}

/** Enum to represent where blocks come from */
export enum BlockSource {
  gossip = "gossip",
  api = "api",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
}

export type BlockInput = {block: allForks.SignedBeaconBlock; source: BlockSource; blockBytes: Uint8Array | null} & (
  | {type: BlockInputType.preDeneb}
  | {type: BlockInputType.postDeneb; blobs: deneb.BlobSidecars; blobsBytes: (Uint8Array | null)[]}
);

export function blockRequiresBlobs(config: ChainForkConfig, blockSlot: Slot, clockSlot: Slot): boolean {
  return (
    config.getForkSeq(blockSlot) >= ForkSeq.deneb &&
    // Only request blobs if they are recent enough
    computeEpochAtSlot(blockSlot) >= computeEpochAtSlot(clockSlot) - MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
  );
}

export enum GossipedInputType {
  block = "block",
  blob = "blob",
}
type GossipedBlockInput =
  | {type: GossipedInputType.block; signedBlock: allForks.SignedBeaconBlock; blockBytes: Uint8Array | null}
  | {type: GossipedInputType.blob; signedBlob: deneb.SignedBlobSidecar; blobBytes: Uint8Array | null};
type BlockInputCacheType = {
  block?: allForks.SignedBeaconBlock;
  blockBytes?: Uint8Array | null;
  blobs: Map<number, deneb.BlobSidecar>;
  blobsBytes: Map<number, Uint8Array | null>;
};

const MAX_GOSSIPINPUT_CACHE = 5;
// TODO deneb: export from types package
// ssz.deneb.BlobSidecars.elementType.fixedSize;
const BLOBSIDECAR_FIXED_SIZE = 131256;

export const getBlockInput = {
  blockInputCache: new Map<RootHex, BlockInputCacheType>(),

  getGossipBlockInput(
    config: ChainForkConfig,
    gossipedInput: GossipedBlockInput
  ):
    | {blockInput: BlockInput; blockInputMeta: {pending: null; haveBlobs: number; expectedBlobs: number}}
    | {blockInput: null; blockInputMeta: {pending: GossipedInputType.block; haveBlobs: number; expectedBlobs: null}}
    | {blockInput: null; blockInputMeta: {pending: GossipedInputType.blob; haveBlobs: number; expectedBlobs: number}} {
    let blockHex;
    let blockCache;

    if (gossipedInput.type === GossipedInputType.block) {
      const {signedBlock, blockBytes} = gossipedInput;

      blockHex = toHexString(
        config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      blockCache = this.blockInputCache.get(blockHex) ?? {
        blobs: new Map<number, deneb.BlobSidecar>(),
        blobsBytes: new Map<number, Uint8Array | null>(),
      };

      blockCache.block = signedBlock;
      blockCache.blockBytes = blockBytes;
    } else {
      const {signedBlob, blobBytes} = gossipedInput;
      blockHex = toHexString(signedBlob.message.blockRoot);
      blockCache = this.blockInputCache.get(blockHex);

      // If a new entry is going to be inserted, prune out old ones
      if (blockCache === undefined) {
        pruneSetToMax(this.blockInputCache, MAX_GOSSIPINPUT_CACHE);
        blockCache = {blobs: new Map<number, deneb.BlobSidecar>(), blobsBytes: new Map<number, Uint8Array | null>()};
      }

      // TODO: freetheblobs check if its the same blob or a duplicate and throw/take actions
      blockCache.blobs.set(signedBlob.message.index, signedBlob.message);
      // easily splice out the unsigned message as blob is a fixed length type
      blockCache.blobsBytes.set(signedBlob.message.index, blobBytes?.slice(0, BLOBSIDECAR_FIXED_SIZE) ?? null);
    }

    this.blockInputCache.set(blockHex, blockCache);
    const {block: signedBlock, blockBytes} = blockCache;

    if (signedBlock !== undefined) {
      // block is available, check if all blobs have shown up
      const {slot, body} = signedBlock.message;
      const {blobKzgCommitments} = body as deneb.BeaconBlockBody;
      const blockInfo = `blockHex=${blockHex}, slot=${slot}`;

      if (blobKzgCommitments.length < blockCache.blobs.size) {
        throw Error(
          `Received more blobs=${blockCache.blobs.size} than commitments=${blobKzgCommitments.length} for ${blockInfo}`
        );
      }
      if (blobKzgCommitments.length === blockCache.blobs.size) {
        const blobSidecars = [];
        const blobsBytes = [];

        for (let index = 0; index < blobKzgCommitments.length; index++) {
          const blobSidecar = blockCache.blobs.get(index);
          if (blobSidecar === undefined) {
            throw Error(`Missing blobSidecar at index=${index} for ${blockInfo}`);
          }
          blobSidecars.push(blobSidecar);
          blobsBytes.push(blockCache.blobsBytes.get(index) ?? null);
        }

        return {
          // TODO freetheblobs: collate and add serialized data for the postDeneb blockinput
          blockInput: getBlockInput.postDeneb(
            config,
            signedBlock,
            BlockSource.gossip,
            blobSidecars,
            blockBytes ?? null,
            blobsBytes
          ),
          blockInputMeta: {pending: null, haveBlobs: blockCache.blobs.size, expectedBlobs: blobKzgCommitments.length},
        };
      } else {
        return {
          blockInput: null,
          blockInputMeta: {
            pending: GossipedInputType.blob,
            haveBlobs: blockCache.blobs.size,
            expectedBlobs: blobKzgCommitments.length,
          },
        };
      }
    } else {
      // will need to wait for the block to showup
      return {
        blockInput: null,
        blockInputMeta: {pending: GossipedInputType.block, haveBlobs: blockCache.blobs.size, expectedBlobs: null},
      };
    }
  },

  preDeneb(
    config: ChainForkConfig,
    block: allForks.SignedBeaconBlock,
    source: BlockSource,
    blockBytes: Uint8Array | null
  ): BlockInput {
    if (config.getForkSeq(block.message.slot) >= ForkSeq.deneb) {
      throw Error(`Post Deneb block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.preDeneb,
      block,
      source,
      blockBytes,
    };
  },

  postDeneb(
    config: ChainForkConfig,
    block: allForks.SignedBeaconBlock,
    source: BlockSource,
    blobs: deneb.BlobSidecars,
    blockBytes: Uint8Array | null,
    blobsBytes: (Uint8Array | null)[]
  ): BlockInput {
    if (config.getForkSeq(block.message.slot) < ForkSeq.deneb) {
      throw Error(`Pre Deneb block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.postDeneb,
      block,
      source,
      blobs,
      blockBytes,
      blobsBytes,
    };
  },
};

export enum AttestationImportOpt {
  Skip,
  Force,
}

export type ImportBlockOpts = {
  /**
   * TEMP: Review if this is safe, Lighthouse always imports attestations even in finalized sync.
   */
  importAttestations?: AttestationImportOpt;
  /**
   * If error would trigger BlockErrorCode ALREADY_KNOWN or GENESIS_BLOCK, just ignore the block and don't verify nor
   * import the block and return void | Promise<void>.
   * Used by range sync and unknown block sync.
   */
  ignoreIfKnown?: boolean;
  /**
   * If error would trigger WOULD_REVERT_FINALIZED_SLOT, it means the block is finalized and we could ignore the block.
   * Don't import and return void | Promise<void>
   * Used by range sync.
   */
  ignoreIfFinalized?: boolean;
  /**
   * From RangeSync module, we won't attest to this block so it's okay to ignore a SYNCING message from execution layer
   */
  fromRangeSync?: boolean;
  /**
   * Verify signatures on main thread or not.
   */
  blsVerifyOnMainThread?: boolean;
  /**
   * Metadata: `true` if only the block proposer signature has been verified
   */
  validProposerSignature?: boolean;
  /**
   * Metadata: `true` if all the signatures including the proposer signature have been verified
   */
  validSignatures?: boolean;
  /** Set to true if already run `validateBlobSidecars()` sucessfully on the blobs */
  validBlobSidecars?: boolean;
  /** Seen timestamp seconds */
  seenTimestampSec?: number;
  /** Set to true if persist block right at verification time */
  eagerPersistBlock?: boolean;
};

/**
 * A wrapper around a `SignedBeaconBlock` that indicates that this block is fully verified and ready to import
 */
export type FullyVerifiedBlock = {
  blockInput: BlockInput;
  postState: CachedBeaconStateAllForks;
  parentBlockSlot: Slot;
  proposerBalanceDelta: number;
  /**
   * If the execution payload couldnt be verified because of EL syncing status,
   * used in optimistic sync or for merge block
   */
  executionStatus: MaybeValidExecutionStatus;
  dataAvailableStatus: DataAvailableStatus;
  /** Seen timestamp seconds */
  seenTimestampSec: number;
};
