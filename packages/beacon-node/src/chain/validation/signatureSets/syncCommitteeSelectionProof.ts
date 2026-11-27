import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF} from "@lodestar/params";
import {ISignatureSet, SignatureSetType, computeSigningRoot} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeSelectionProofSignatureSet(
  config: BeaconConfig,
  contributionAndProof: altair.ContributionAndProof
): ISignatureSet {
  const slot = contributionAndProof.contribution.slot;
  const domain = config.getDomainAtFork(config.getForkName(slot), DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF);
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
