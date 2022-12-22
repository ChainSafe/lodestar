import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@lodestar/state-transition";
import {MaybeValidExecutionStatus} from "@lodestar/fork-choice";
import {allForks, eip4844, Slot} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {IChainForkConfig} from "@lodestar/config";

export enum BlockInputType {
  preEIP4844 = "preEIP4844",
  postEIP4844 = "postEIP4844",
  postEIP4844OldBlobs = "postEIP4844OldBlobs",
}

export type BlockInput =
  | {type: BlockInputType.preEIP4844; block: allForks.SignedBeaconBlock}
  | {type: BlockInputType.postEIP4844; block: allForks.SignedBeaconBlock; blobs: eip4844.BlobsSidecar}
  | {type: BlockInputType.postEIP4844OldBlobs; block: allForks.SignedBeaconBlock};

export function blockRequiresBlobs(config: IChainForkConfig, blockSlot: Slot, clockSlot: Slot): boolean {
  return (
    config.getForkSeq(blockSlot) >= ForkSeq.eip4844 &&
    // Only request blobs if they are recent enough
    computeEpochAtSlot(blockSlot) >= computeEpochAtSlot(clockSlot) - config.MIN_EPOCHS_FOR_BLOBS_SIDECARS_REQUESTS
  );
}

export const getBlockInput = {
  preEIP4844(config: IChainForkConfig, block: allForks.SignedBeaconBlock): BlockInput {
    if (config.getForkSeq(block.message.slot) >= ForkSeq.eip4844) {
      throw Error(`Post EIP4844 block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.preEIP4844,
      block,
    };
  },

  postEIP4844(config: IChainForkConfig, block: allForks.SignedBeaconBlock, blobs: eip4844.BlobsSidecar): BlockInput {
    if (config.getForkSeq(block.message.slot) < ForkSeq.eip4844) {
      throw Error(`Pre EIP4844 block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.postEIP4844,
      block,
      blobs,
    };
  },

  postEIP4844OldBlobs(config: IChainForkConfig, block: allForks.SignedBeaconBlock): BlockInput {
    if (config.getForkSeq(block.message.slot) < ForkSeq.eip4844) {
      throw Error(`Pre EIP4844 block slot ${block.message.slot}`);
    }
    return {
      type: BlockInputType.postEIP4844OldBlobs,
      block,
    };
  },
};

export type ImportBlockOpts = {
  /**
   * TEMP: Review if this is safe, Lighthouse always imports attestations even in finalized sync.
   */
  skipImportingAttestations?: boolean;
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
  /** Seen timestamp seconds */
  seenTimestampSec: number;
};
