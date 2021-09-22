import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-types";

export type FullyVerifiedBlockFlags = {
  /**
   * TEMP: Review if this is safe, Lighthouse always imports attestations even in finalized sync.
   */
  skipImportingAttestations?: boolean;
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
