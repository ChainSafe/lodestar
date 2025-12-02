import {DOMAIN_CONTRIBUTION_AND_PROOF} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getContributionAndProofSignatureSet(
  state: CachedBeaconStateAllForks,
  signedContributionAndProof: altair.SignedContributionAndProof
): ISignatureSet {
  const {epochCtx} = state;
  const domain = state.config.getDomain(
    state.slot,
    DOMAIN_CONTRIBUTION_AND_PROOF,
    signedContributionAndProof.message.contribution.slot
  );
  const signingData = signedContributionAndProof.message;
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedContributionAndProof.message.aggregatorIndex],
    signingRoot: computeSigningRoot(ssz.altair.ContributionAndProof, signingData, domain),
    signature: signedContributionAndProof.signature,
  };
}
