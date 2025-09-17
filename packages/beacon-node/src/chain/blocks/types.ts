import type {ChainForkConfig} from "@lodestar/config";
import {MaybeValidExecutionStatus} from "@lodestar/fork-choice";
import {ForkSeq} from "@lodestar/params";
import {CachedBeaconStateAllForks, DataAvailabilityStatus, computeEpochAtSlot} from "@lodestar/state-transition";
import type {Slot, fulu} from "@lodestar/types";
import {IBlockInput} from "./blockInput/types.js";

export enum GossipedInputType {
  block = "block",
  blob = "blob",
  dataColumn = "data_column",
}

type DataColumnData = {
  dataColumn: fulu.DataColumnSidecar;
  dataColumnBytes: Uint8Array | null;
};
export type DataColumnsCacheMap = Map<number, DataColumnData>;

export function blockRequiresBlobs(config: ChainForkConfig, blockSlot: Slot, clockSlot: Slot): boolean {
  return (
    config.getForkSeq(blockSlot) >= ForkSeq.deneb &&
    // Only request blobs if they are recent enough
    computeEpochAtSlot(blockSlot) >= computeEpochAtSlot(clockSlot) - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
  );
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
  blockInput: IBlockInput;
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
