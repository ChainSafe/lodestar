import {CachedBeaconStateAllForks, computeEpochAtSlot, DataAvailableStatus} from "@lodestar/state-transition";
import {MaybeValidExecutionStatus} from "@lodestar/fork-choice";
import {allForks, deneb, Slot} from "@lodestar/types";
import {ForkSeq, MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";

import {ckzg} from "../../util/kzg.js";

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
  | {type: BlockInputType.postDeneb; blobs: deneb.BlobsSidecar}
);

export function blockRequiresBlobs(config: ChainForkConfig, blockSlot: Slot, clockSlot: Slot): boolean {
  return (
    config.getForkSeq(blockSlot) >= ForkSeq.deneb &&
    // Only request blobs if they are recent enough
    computeEpochAtSlot(blockSlot) >= computeEpochAtSlot(clockSlot) - MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
  );
}

// TODO DENEB: a helper function to convert blobSidecars to blobsSidecar, to be cleanup on BlockInput
// migration
export function blobSidecarsToBlobsSidecar(
  config: ChainForkConfig,
  signedBlock: allForks.SignedBeaconBlock,
  blobSidecars: deneb.BlobSidecars
): deneb.BlobsSidecar {
  const beaconBlockSlot = signedBlock.message.slot;
  const beaconBlockRoot = config.getForkTypes(beaconBlockSlot).BeaconBlock.hashTreeRoot(signedBlock.message);
  const blobs = blobSidecars.map(({blob}) => blob);
  const blobsSidecar = {
    beaconBlockRoot,
    beaconBlockSlot,
    blobs,
    kzgAggregatedProof: ckzg.computeAggregateKzgProof(blobs),
  };
  return blobsSidecar;
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
    source: BlockSource,
    blobs: deneb.BlobsSidecar,
    blockBytes: Uint8Array | null
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
  /** Set to true if already run `validateBlobsSidecar()` sucessfully on the blobs */
  validBlobsSidecar?: boolean;
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
