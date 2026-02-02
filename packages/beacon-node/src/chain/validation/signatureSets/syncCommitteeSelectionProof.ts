import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeSelectionProofSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  contributionAndProof: altair.ContributionAndProof
): ISignatureSet {
  const slot = contributionAndProof.contribution.slot;
  const domain = config.getDomain(state.slot, DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, slot);
  const signingData: altair.SyncAggregatorSelectionData = {
    slot,
    subcommitteeIndex: contributionAndProof.contribution.subcommitteeIndex,
  };
  return {
    type: SignatureSetType.indexed,
    index: contributionAndProof.aggregatorIndex,
    signingRoot: computeSigningRoot(ssz.altair.SyncAggregatorSelectionData, signingData, domain),
    signature: contributionAndProof.selectionProof,
  };
}
