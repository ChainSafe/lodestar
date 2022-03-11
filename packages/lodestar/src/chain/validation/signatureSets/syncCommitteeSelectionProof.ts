import {DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF} from "@chainsafe/lodestar-params";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeSelectionProofSignatureSet(
  state: CachedBeaconStateAllForks,
  contributionAndProof: altair.ContributionAndProof
): ISignatureSet {
  const {epochCtx, config} = state;
  const slot = contributionAndProof.contribution.slot;
  const domain = config.getDomain(DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, slot);
  const signingData: altair.SyncAggregatorSelectionData = {
    slot,
    subcommitteeIndex: contributionAndProof.contribution.subcommitteeIndex,
  };
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[contributionAndProof.aggregatorIndex],
    signingRoot: computeSigningRoot(ssz.altair.SyncAggregatorSelectionData, signingData, domain),
    signature: contributionAndProof.selectionProof.valueOf() as Uint8Array,
  };
}
