import {DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF} from "@chainsafe/lodestar-params";
import {allForks, altair, ssz} from "@chainsafe/lodestar-types";
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
  const {epochCtx} = state;
  const slot = contributionAndProof.contribution.slot;
  const epoch = computeEpochAtSlot(slot);
  const domain = getDomain(state, DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, epoch);
  const signingData: altair.SyncCommitteeSigningData = {
    slot,
    subCommitteeIndex: contributionAndProof.contribution.subCommitteeIndex,
  };
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[contributionAndProof.aggregatorIndex],
    signingRoot: computeSigningRoot(ssz.altair.SyncCommitteeSigningData, signingData, domain),
    signature: contributionAndProof.selectionProof.valueOf() as Uint8Array,
  };
}
