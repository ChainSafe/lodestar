import {ProposerSlashing} from "@chainsafe/lodestar-types";
import {DomainType} from "../../constants";
import {computeEpochAtSlot, computeSigningRoot, getDomain, isSlashableValidator} from "../../util";
import {slashValidator} from "./slashValidator";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";
import {CachedBeaconState} from "../util/cachedBeaconState";

export function processProposerSlashing(
  cachedState: CachedBeaconState,
  proposerSlashing: ProposerSlashing,
  verifySignatures = true
): void {
  const config = cachedState.config;
  const {BeaconBlockHeader} = config.types;
  const header1 = proposerSlashing.signedHeader1.message;
  const header2 = proposerSlashing.signedHeader2.message;

  // verify header slots match
  if (header1.slot !== header2.slot) {
    throw new Error("ProposerSlashing slots do not match: " + `slot1=${header1.slot} slot2=${header2.slot}`);
  }
  // verify header proposer indices match
  if (header1.proposerIndex !== header2.proposerIndex) {
    throw new Error(
      "ProposerSlashing proposer indices do not match: " +
        `proposerIndex1=${header1.proposerIndex} slot2=${header2.proposerIndex}`
    );
  }
  // verify headers are different
  if (BeaconBlockHeader.equals(header1, header2)) {
    throw new Error("ProposerSlashing headers are equal");
  }
  // verify the proposer is slashable
  const proposer = cachedState.validators[header1.proposerIndex];
  if (!isSlashableValidator(proposer, cachedState.currentShuffling.epoch)) {
    throw new Error("ProposerSlashing proposer is not slashable");
  }

  // verify signatures
  if (verifySignatures) {
    getProposerSlashingSignatureSets(cachedState, proposerSlashing).forEach((signatureSet, i) => {
      if (!verifySignatureSet(signatureSet)) {
        throw new Error(`ProposerSlashing header${i + 1} signature invalid`);
      }
    });
  }

  slashValidator(cachedState, header1.proposerIndex);
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getProposerSlashingSignatureSets(
  cachedState: CachedBeaconState,
  proposerSlashing: ProposerSlashing
): ISignatureSet[] {
  const config = cachedState.config;
  const pubkey = cachedState.index2pubkey[proposerSlashing.signedHeader1.message.proposerIndex];

  return [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].map(
    (signedHeader): ISignatureSet => {
      const epoch = computeEpochAtSlot(config, signedHeader.message.slot);
      const domain = getDomain(config, cachedState, DomainType.BEACON_PROPOSER, epoch);

      return {
        type: SignatureSetType.single,
        pubkey,
        signingRoot: computeSigningRoot(config, config.types.BeaconBlockHeader, signedHeader.message, domain),
        signature: signedHeader.signature,
      };
    }
  );
}
