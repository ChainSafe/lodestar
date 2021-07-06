import {DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF} from "@chainsafe/lodestar-params";
import {allForks, altair, ssz} from "@chainsafe/lodestar-types";
import {
  CachedBeaconState,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeSelectionProofSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  contributionAndProof: altair.ContributionAndProof
): ISignatureSet {
  const {epochCtx, config} = state;
  const slot = contributionAndProof.contribution.slot;
  const domain = config.getDomain(DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, slot);
  const signingData: altair.SyncAggregatorSelectionData = {
    slot,
    subCommitteeIndex: contributionAndProof.contribution.subCommitteeIndex,
  };
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[contributionAndProof.aggregatorIndex],
    signingRoot: computeSigningRoot(ssz.altair.SyncAggregatorSelectionData, signingData, domain),
    signature: contributionAndProof.selectionProof.valueOf() as Uint8Array,
  };
}
