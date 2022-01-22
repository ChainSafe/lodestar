import {DOMAIN_BEACON_PROPOSER} from "@chainsafe/lodestar-params";
import {readonlyValues} from "@chainsafe/ssz";
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
      const domain = state.config.getDomain(DOMAIN_BEACON_PROPOSER, signedHeader.message.slot);
      const beaconBlockHeaderType = ssz.phase0.BeaconBlockHeader;

      return {
        type: SignatureSetType.single,
        pubkey,
        signingRoot: computeSigningRoot(beaconBlockHeaderType, signedHeader.message, domain),
        signature: signedHeader.signature.valueOf() as Uint8Array,
      };
    }
  );
}

export function getProposerSlashingsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return Array.from(readonlyValues(signedBlock.message.body.proposerSlashings), (proposerSlashing) =>
    getProposerSlashingSignatureSets(state, proposerSlashing)
  ).flat(1);
}
