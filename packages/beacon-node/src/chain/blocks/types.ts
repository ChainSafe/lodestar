import {CachedBeaconStateAllForks, computeEpochAtSlot, DataAvailableStatus} from "@lodestar/state-transition";
import {MaybeValidExecutionStatus} from "@lodestar/fork-choice";
import {allForks, deneb, electra, Slot, RootHex} from "@lodestar/types";
import {ForkSeq, ForkName, ForkILs} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";

export enum BlockInputType {
  preDeneb = "preDeneb",
  postDeneb = "postDeneb",
  blobsPromise = "blobsPromise",
}

/** Enum to represent where blocks come from */
export enum BlockSource {
  gossip = "gossip",
  api = "api",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
}

export enum GossipedInputType {
  block = "block",
  blob = "blob",
  ilist = "ilist",
}

export enum BlockInputILType {
  childBlock = "childBlock",
  actualIL = "actualIL",
  syncing = "syncing",
}

type ForkBlobsInfo = {fork: ForkName.deneb};
type ForkILsInfo = {fork: ForkILs};

export type BlobsCache = Map<number, {blobSidecar: deneb.BlobSidecar; blobBytes: Uint8Array | null}>;

type BlobsData = {blobs: deneb.BlobSidecars; blobsBytes: (Uint8Array | null)[]};
type ILsData = BlobsData &
  (
    | {ilType: BlockInputILType.childBlock | BlockInputILType.syncing}
    | {ilType: BlockInputILType.actualIL; inclusionList: electra.InclusionList}
  );

export type BlockInputDataBlobs = ForkBlobsInfo & BlobsData;
export type BlockInputDataIls = ForkILsInfo & ILsData;
export type BlockInputData = BlockInputDataBlobs | BlockInputDataIls;

type BlobsInputCache = {blobsCache: BlobsCache};
type ForkILsCache = BlobsInputCache & {
  inclusionList?: electra.InclusionList;
};

export type BlockInputCacheBlobs = ForkBlobsInfo & BlobsInputCache;
export type BlockInputCacheILs = ForkILsInfo & ForkILsCache;
export type BlockInputCache = (ForkBlobsInfo & BlobsInputCache) | (ForkILsInfo & ForkILsCache);

type Availability<T> = {availabilityPromise: Promise<T>; resolveAvailability: (data: T) => void};
export type CachedData =
  | (ForkBlobsInfo & BlobsInputCache & Availability<BlockInputDataBlobs>)
  | (ForkILsInfo & ForkILsCache & Availability<BlockInputDataIls>);

export type BlockInput = {block: allForks.SignedBeaconBlock; source: BlockSource; blockBytes: Uint8Array | null} & (
  | {type: BlockInputType.preDeneb}
  | ({type: BlockInputType.postDeneb} & {blockData: BlockInputData})
  | ({type: BlockInputType.blobsPromise} & {cachedData: CachedData})
);
export type NullBlockInput = {block: null; blockRootHex: RootHex; blockInputPromise: Promise<BlockInput>} & {
  cachedData: CachedData;
};

export function blockRequiresBlobs(config: ChainForkConfig, blockSlot: Slot, clockSlot: Slot): boolean {
  return (
    config.getForkSeq(blockSlot) >= ForkSeq.deneb &&
    // Only request blobs if they are recent enough
    computeEpochAtSlot(blockSlot) >= computeEpochAtSlot(clockSlot) - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
  );
}

export const getBlockInput = {
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
    blockBytes: Uint8Array | null,
    blockData: BlockInputData,
    source: BlockSource
  ): BlockInput {
    if (config.getForkSeq(block.message.slot) < ForkSeq.deneb) {
      throw Error(`Pre Deneb block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.postDeneb,
      block,
      blockBytes,
      blockData,
      source,
    };
  },

  blobsPromise(
    config: ChainForkConfig,
    block: allForks.SignedBeaconBlock,
    blockBytes: Uint8Array | null,
    cachedData: CachedData,
    source: BlockSource
  ): BlockInput {
    if (config.getForkSeq(block.message.slot) < ForkSeq.deneb) {
      throw Error(`Pre Deneb block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.blobsPromise,
      block,
      blockBytes,
      source,
      cachedData,
    };
  },
};

export function getBlockInputBlobs(blobsCache: BlobsCache): BlobsData {
  const blobs = [];
  const blobsBytes = [];

  for (let index = 0; index < blobsCache.size; index++) {
    const blobCache = blobsCache.get(index);
    if (blobCache === undefined) {
      throw Error(`Missing blobSidecar at index=${index}`);
    }
    const {blobSidecar, blobBytes} = blobCache;
    blobs.push(blobSidecar);
    blobsBytes.push(blobBytes);
  }
  return {blobs, blobsBytes};
}

export enum AttestationImportOpt {
  Skip,
  Force,
}

export enum BlobSidecarValidation {
  /** When recieved in gossip the blobs are individually verified before import */
  Individual,
  /**
   * Blobs when recieved in req/resp can be fully verified before import
   * but currently used in spec tests where blobs come without proofs and assumed
   * to be valid
   */
  Full,
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
  validBlobSidecars?: BlobSidecarValidation;
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
