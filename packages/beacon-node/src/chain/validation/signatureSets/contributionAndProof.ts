import {DOMAIN_CONTRIBUTION_AND_PROOF} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  ISignatureSet,
  Index2PubkeyCache,
  SignatureSetType,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getContributionAndProofSignatureSet(
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedContributionAndProof: altair.SignedContributionAndProof
): ISignatureSet {
  const domain = state.config.getDomain(
    state.slot,
    DOMAIN_CONTRIBUTION_AND_PROOF,
    signedContributionAndProof.message.contribution.slot
  );
  const signingData = signedContributionAndProof.message;
  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[signedContributionAndProof.message.aggregatorIndex],
    signingRoot: computeSigningRoot(ssz.altair.ContributionAndProof, signingData, domain),
    signature: signedContributionAndProof.signature,
  };
}
