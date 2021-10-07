import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-types";

export type FullyVerifiedBlockFlags = {
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
};

export type PartiallyVerifiedBlockFlags = FullyVerifiedBlockFlags & {
  /**
   * Metadata: `true` if only the block proposer signature has been verified
   */
  validProposerSignature?: boolean;
  /**
   * Metadata: `true` if all the signatures including the proposer signature have been verified
   */
  validSignatures?: boolean;
  /**
   * From RangeSync module, we won't attest to this block so it's okay to ignore a SYNCING message from execution layer
   */
  fromRangeSync?: boolean;
};

/**
 * A wrapper around a `SignedBeaconBlock` that indicates that this block is fully verified and ready to import
 */
export type FullyVerifiedBlock = FullyVerifiedBlockFlags & {
  block: allForks.SignedBeaconBlock;
  postState: CachedBeaconState<allForks.BeaconState>;
};

/**
 * A wrapper around a block that's partially verified: after gossip validation `validProposerSignature = true`
 */
export type PartiallyVerifiedBlock = PartiallyVerifiedBlockFlags & {
  block: allForks.SignedBeaconBlock;
};
