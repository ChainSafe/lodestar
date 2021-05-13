import {readonlyValues} from "@chainsafe/ssz";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {computeSigningRoot, ISignatureSet, SignatureSetType} from "../../util";
import {CachedBeaconState} from "../util";

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getProposerSlashingSignatureSets(
  state: CachedBeaconState<allForks.BeaconState>,
  proposerSlashing: phase0.ProposerSlashing
): ISignatureSet[] {
  const {config, epochCtx} = state;
  const pubkey = epochCtx.index2pubkey[proposerSlashing.signedHeader1.message.proposerIndex];

  return [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].map(
    (signedHeader): ISignatureSet => {
      const domain = state.getDomain(config.params.DOMAIN_BEACON_PROPOSER, signedHeader.message.slot);

      return {
        type: SignatureSetType.single,
        pubkey,
        signingRoot: computeSigningRoot(config, config.types.phase0.BeaconBlockHeader, signedHeader.message, domain),
        signature: signedHeader.signature.valueOf() as Uint8Array,
      };
    }
  );
}

export function getProposerSlashingsSignatureSets(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return Array.from(readonlyValues(signedBlock.message.body.proposerSlashings), (proposerSlashing) =>
    getProposerSlashingSignatureSets(state, proposerSlashing)
  ).flat(1);
}
