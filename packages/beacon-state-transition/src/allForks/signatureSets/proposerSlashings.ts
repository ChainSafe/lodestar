import {DOMAIN_BEACON_PROPOSER} from "@chainsafe/lodestar-params";
import {allForks, phase0, ssz} from "@chainsafe/lodestar-types";
import {computeSigningRoot, ISignatureSet, SignatureSetType} from "../../util";
import {CachedBeaconStateAllForks} from "../../types";

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getProposerSlashingSignatureSets(
  state: CachedBeaconStateAllForks,
  proposerSlashing: phase0.ProposerSlashing
): ISignatureSet[] {
  const {epochCtx} = state;
  const pubkey = epochCtx.index2pubkey[proposerSlashing.signedHeader1.message.proposerIndex];

  return [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].map(
    (signedHeader): ISignatureSet => {
      const domain = state.config.getDomain(DOMAIN_BEACON_PROPOSER, Number(signedHeader.message.slot as bigint));

      return {
        type: SignatureSetType.single,
        pubkey,
        signingRoot: computeSigningRoot(ssz.phase0.BeaconBlockHeaderBn, signedHeader.message, domain),
        signature: signedHeader.signature,
      };
    }
  );
}

export function getProposerSlashingsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.proposerSlashings
    .map((proposerSlashing) => getProposerSlashingSignatureSets(state, proposerSlashing))
    .flat(1);
}
