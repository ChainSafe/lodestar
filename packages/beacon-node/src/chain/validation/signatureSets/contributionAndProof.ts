import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_CONTRIBUTION_AND_PROOF} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getContributionAndProofSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  signedContributionAndProof: altair.SignedContributionAndProof
): ISignatureSet {
  const domain = config.getDomain(
    state.slot,
    DOMAIN_CONTRIBUTION_AND_PROOF,
    signedContributionAndProof.message.contribution.slot
  );
  const signingData = signedContributionAndProof.message;
  return {
    type: SignatureSetType.indexed,
    index: signedContributionAndProof.message.aggregatorIndex,
    signingRoot: computeSigningRoot(ssz.altair.ContributionAndProof, signingData, domain),
    signature: signedContributionAndProof.signature,
  };
}
