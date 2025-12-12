import {DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  ISignatureSet,
  Index2PubkeyCache,
  SignatureSetType,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeSelectionProofSignatureSet(
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  contributionAndProof: altair.ContributionAndProof
): ISignatureSet {
  const {config} = state;
  const slot = contributionAndProof.contribution.slot;
  const domain = config.getDomain(state.slot, DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, slot);
  const signingData: altair.SyncAggregatorSelectionData = {
    slot,
    subcommitteeIndex: contributionAndProof.contribution.subcommitteeIndex,
  };
  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[contributionAndProof.aggregatorIndex],
    signingRoot: computeSigningRoot(ssz.altair.SyncAggregatorSelectionData, signingData, domain),
    signature: contributionAndProof.selectionProof,
  };
}
