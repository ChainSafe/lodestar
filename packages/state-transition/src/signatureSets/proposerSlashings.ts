import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {SignedBeaconBlock, Slot, phase0, ssz} from "@lodestar/types";
import {ISignatureSet, SignatureSetType, computeSigningRoot} from "../util/index.js";

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getProposerSlashingSignatureSets(
  config: BeaconConfig,
  stateSlot: Slot,
  proposerSlashing: phase0.ProposerSlashing
): ISignatureSet[] {
  const proposerIndex = proposerSlashing.signedHeader1.message.proposerIndex;

  // In state transition, ProposerSlashing headers are only partially validated. Their slot could be higher than the
  // clock and the slashing would still be valid. Must use bigint variants to hash correctly to all possible values
  return [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].map((signedHeader): ISignatureSet => {
    const domain = config.getDomain(stateSlot, DOMAIN_BEACON_PROPOSER, Number(signedHeader.message.slot as bigint));

    return {
      type: SignatureSetType.indexed,
      index: proposerIndex,
      signingRoot: computeSigningRoot(ssz.phase0.BeaconBlockHeaderBigint, signedHeader.message, domain),
      signature: signedHeader.signature,
    };
  });
}

export function getProposerSlashingsSignatureSets(
  config: BeaconConfig,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  const blockSlot = signedBlock.message.slot;
  return signedBlock.message.body.proposerSlashings.flatMap((proposerSlashing) =>
    getProposerSlashingSignatureSets(config, blockSlot, proposerSlashing)
  );
}
