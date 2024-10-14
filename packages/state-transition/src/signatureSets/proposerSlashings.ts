import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {SignedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {computeSigningRoot, ISignatureSet, SignatureSetType} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getProposerSlashingSignatureSets(
  state: CachedBeaconStateAllForks,
  proposerSlashing: phase0.ProposerSlashing
): ISignatureSet[] {
  const {epochCtx} = state;
  const pubkey = epochCtx.index2pubkey[proposerSlashing.signedHeader1.message.proposerIndex];

  // In state transition, ProposerSlashing headers are only partially validated. Their slot could be higher than the
  // clock and the slashing would still be valid. Must use bigint variants to hash correctly to all possible values
  return [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].map((signedHeader): ISignatureSet => {
    const domain = state.config.getDomain(
      state.slot,
      DOMAIN_BEACON_PROPOSER,
      Number(signedHeader.message.slot as bigint)
    );

    return {
      type: SignatureSetType.single,
      pubkey,
      signingRoot: computeSigningRoot(ssz.phase0.BeaconBlockHeaderBigint, signedHeader.message, domain),
      signature: signedHeader.signature,
    };
  });
}

export function getProposerSlashingsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.proposerSlashings.flatMap((proposerSlashing) =>
    getProposerSlashingSignatureSets(state, proposerSlashing)
  );
}
