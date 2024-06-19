import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@lodestar/state-transition";
import {MaybeValidExecutionStatus, DataAvailabilityStatus} from "@lodestar/fork-choice";
import {allForks, deneb, Slot, RootHex} from "@lodestar/types";
import {ForkSeq, ForkName} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";

export enum BlockInputType {
  // preData is preDeneb
  preData = "preData",
  // data is out of available window, can be used to sync forward and keep adding to forkchoice
  outOfRangeData = "outOfRangeData",
  availableData = "availableData",
  dataPromise = "dataPromise",
}

/** Enum to represent where blocks come from */
export enum BlockSource {
  gossip = "gossip",
  api = "api",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
}

/** Enum to represent where blobs come from */
export enum BlobsSource {
  gossip = "gossip",
  api = "api",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
}

export enum GossipedInputType {
  block = "block",
  blob = "blob",
}

type BlobsCacheMap = Map<number, {blobSidecar: deneb.BlobSidecar; blobBytes: Uint8Array | null}>;

type ForkBlobsInfo = {fork: ForkName.deneb | ForkName.electra};
type BlobsData = {blobs: deneb.BlobSidecars; blobsBytes: (Uint8Array | null)[]; blobsSource: BlobsSource};
export type BlockInputDataBlobs = ForkBlobsInfo & BlobsData;
export type BlockInputData = BlockInputDataBlobs;

export type BlockInputBlobs = {blobs: deneb.BlobSidecars; blobsBytes: (Uint8Array | null)[]; blobsSource: BlobsSource};
type Availability<T> = {availabilityPromise: Promise<T>; resolveAvailability: (data: T) => void};

type CachedBlobs = {blobsCache: BlobsCacheMap} & Availability<BlockInputDataBlobs>;
export type CachedData = ForkBlobsInfo & CachedBlobs;

export type BlockInput = {block: allForks.SignedBeaconBlock; source: BlockSource; blockBytes: Uint8Array | null} & (
  | {type: BlockInputType.preData | BlockInputType.outOfRangeData}
  | ({type: BlockInputType.availableData} & {blockData: BlockInputData})
  // the blobsSource here is added to BlockInputBlobs when availability is resolved
  | ({type: BlockInputType.dataPromise} & {cachedData: CachedData})
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
  preData(
    config: ChainForkConfig,
    block: allForks.SignedBeaconBlock,
    source: BlockSource,
    blockBytes: Uint8Array | null
  ): BlockInput {
    if (config.getForkSeq(block.message.slot) >= ForkSeq.deneb) {
      throw Error(`Post Deneb block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.preData,
      block,
      source,
      blockBytes,
    };
  },

  // This isn't used right now but we might enable importing blobs into forkchoice from a point
  // where data is not guaranteed to be available to hopefully reach a point where we have
  // available data. Hence the validator duties can't be performed on outOfRangeData
  //
  // This can help with some of the requests of syncing without data for some use cases for e.g.
  // building states or where importing data isn't important if valid child exists like ILs
  outOfRangeData(
    config: ChainForkConfig,
    block: allForks.SignedBeaconBlock,
    source: BlockSource,
    blockBytes: Uint8Array | null
  ): BlockInput {
    if (config.getForkSeq(block.message.slot) < ForkSeq.deneb) {
      throw Error(`Pre Deneb block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.outOfRangeData,
      block,
      source,
      blockBytes,
    };
  },

  availableData(
    config: ChainForkConfig,
    block: allForks.SignedBeaconBlock,
    source: BlockSource,
    blockBytes: Uint8Array | null,
    blockData: BlockInputData
  ): BlockInput {
    if (config.getForkSeq(block.message.slot) < ForkSeq.deneb) {
      throw Error(`Pre Deneb block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.availableData,
      block,
      source,
      blockBytes,
      blockData,
    };
  },

  dataPromise(
    config: ChainForkConfig,
    block: allForks.SignedBeaconBlock,
    source: BlockSource,
    blockBytes: Uint8Array | null,
    cachedData: CachedData
  ): BlockInput {
    if (config.getForkSeq(block.message.slot) < ForkSeq.deneb) {
      throw Error(`Pre Deneb block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.dataPromise,
      block,
      source,
      blockBytes,
      cachedData,
    };
  },
};

export function getBlockInputBlobs(blobsCache: BlobsCacheMap): Omit<BlobsData, "blobsSource"> {
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
  dataAvailabilityStatus: DataAvailabilityStatus;
  /** Seen timestamp seconds */
  seenTimestampSec: number;
};
