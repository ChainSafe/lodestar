import {DOMAIN_CONTRIBUTION_AND_PROOF} from "@chainsafe/lodestar-params";
import {allForks, altair, ssz} from "@chainsafe/lodestar-types";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeSigningRoot,
  getDomain,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getContributionAndProofSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  signedContributionAndProof: altair.SignedContributionAndProof
): ISignatureSet {
  const {epochCtx} = state;
  const msgEpoch = computeEpochAtSlot(signedContributionAndProof.message.contribution.slot);
  const domain = getDomain(state, DOMAIN_CONTRIBUTION_AND_PROOF, msgEpoch);
  const signingData = signedContributionAndProof.message;
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedContributionAndProof.message.aggregatorIndex],
    signingRoot: computeSigningRoot(ssz.altair.ContributionAndProof, signingData, domain),
    signature: signedContributionAndProof.signature.valueOf() as Uint8Array,
  };
}
