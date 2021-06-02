import {allForks, altair} from "@chainsafe/lodestar-types";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeSigningRoot,
  getDomain,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeSelectionProofSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  contributionAndProof: altair.ContributionAndProof
): ISignatureSet {
  const {config, epochCtx} = state;
  const slot = contributionAndProof.contribution.slot;
  const epochSig = computeEpochAtSlot(config, slot);
  const domain = getDomain(config, state, config.params.DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, epochSig);
  const signingData: altair.SyncAggregatorSelectionData = {
    slot,
    subCommitteeIndex: contributionAndProof.contribution.subCommitteeIndex,
  };
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[contributionAndProof.aggregatorIndex],
    signingRoot: computeSigningRoot(config, config.types.altair.SyncAggregatorSelectionData, signingData, domain),
    signature: contributionAndProof.selectionProof.valueOf() as Uint8Array,
  };
}
