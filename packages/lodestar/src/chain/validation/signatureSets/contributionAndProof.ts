import {DOMAIN_CONTRIBUTION_AND_PROOF} from "@chainsafe/lodestar-params";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getContributionAndProofSignatureSet(
  state: CachedBeaconStateAllForks,
  signedContributionAndProof: altair.SignedContributionAndProof
): ISignatureSet {
  const {epochCtx} = state;
  const domain = state.config.getDomain(
    DOMAIN_CONTRIBUTION_AND_PROOF,
    signedContributionAndProof.message.contribution.slot
  );
  const signingData = signedContributionAndProof.message;
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedContributionAndProof.message.aggregatorIndex],
    signingRoot: computeSigningRoot(ssz.altair.ContributionAndProof, signingData, domain),
    signature: signedContributionAndProof.signature.valueOf() as Uint8Array,
  };
}
