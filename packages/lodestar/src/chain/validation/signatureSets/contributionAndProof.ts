import {allForks, altair} from "@chainsafe/lodestar-types";
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
  const {config, epochCtx} = state;
  const slot = signedContributionAndProof.message.contribution.slot;
  const epoch = computeEpochAtSlot(config, slot);
  const domain = getDomain(config, state, config.params.DOMAIN_CONTRIBUTION_AND_PROOF, epoch);
  const signingData = signedContributionAndProof.message;
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedContributionAndProof.message.aggregatorIndex],
    signingRoot: computeSigningRoot(config, config.types.altair.ContributionAndProof, signingData, domain),
    signature: signedContributionAndProof.signature.valueOf() as Uint8Array,
  };
}
