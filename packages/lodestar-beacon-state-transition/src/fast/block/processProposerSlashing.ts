import {BeaconState, ProposerSlashing} from "@chainsafe/lodestar-types";
import {DomainType} from "../../constants";
import {computeEpochAtSlot, computeSigningRoot, getDomain, isSlashableValidator} from "../../util";
import {EpochContext} from "../util";
import {slashValidator} from "./slashValidator";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";

export function processProposerSlashing(
  epochCtx: EpochContext,
  state: BeaconState,
  proposerSlashing: ProposerSlashing,
  verifySignatures = true
): void {
  const config = epochCtx.config;
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
  const proposer = state.validators[header1.proposerIndex];
  if (!isSlashableValidator(proposer, epochCtx.currentShuffling.epoch)) {
    throw new Error("ProposerSlashing proposer is not slashable");
  }

  // verify signatures
  if (verifySignatures) {
    getProposerSlashingSignatureSets(epochCtx, state, proposerSlashing).forEach((signatureSet, i) => {
      if (!verifySignatureSet(signatureSet)) {
        throw new Error(`ProposerSlashing header${i + 1} signature invalid`);
      }
    });
  }

  slashValidator(epochCtx, state, header1.proposerIndex);
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getProposerSlashingSignatureSets(
  epochCtx: EpochContext,
  state: BeaconState,
  proposerSlashing: ProposerSlashing
): ISignatureSet[] {
  const config = epochCtx.config;
  const pubkey = epochCtx.index2pubkey[proposerSlashing.signedHeader1.message.proposerIndex];

  return [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].map(
    (signedHeader): ISignatureSet => {
      const epoch = computeEpochAtSlot(config, signedHeader.message.slot);
      const domain = getDomain(config, state, DomainType.BEACON_PROPOSER, epoch);

      return {
        type: SignatureSetType.single,
        pubkey,
        signingRoot: computeSigningRoot(config, config.types.BeaconBlockHeader, signedHeader.message, domain),
        signature: signedHeader.signature,
      };
    }
  );
}
