import {phase0, ssz} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {isSlashableValidator} from "../util/index.js";
import {verifySignatureSet} from "../util/signatureSets.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {getProposerSlashingSignatureSets} from "../signatureSets/index.js";
import {slashValidator} from "./slashValidator.js";

/**
 * Process a ProposerSlashing operation. Initiates the exit of a validator, decreases the balance of the slashed
 * validator and increases the block proposer balance.
 *
 * PERF: Work depends on number of ProposerSlashing per block. On regular networks the average is 0 / block.
 */
export function processProposerSlashing(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  assertValidProposerSlashing(state, proposerSlashing, verifySignatures);

  slashValidator(fork, state, proposerSlashing.signedHeader1.message.proposerIndex);
}

export function assertValidProposerSlashing(
  state: CachedBeaconStateAllForks,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  const header1 = proposerSlashing.signedHeader1.message;
  const header2 = proposerSlashing.signedHeader2.message;

  // verify header slots match
  if (header1.slot !== header2.slot) {
    throw new Error(`ProposerSlashing slots do not match: slot1=${header1.slot} slot2=${header2.slot}`);
  }

  // verify header proposer indices match
  if (header1.proposerIndex !== header2.proposerIndex) {
    throw new Error(
      `ProposerSlashing proposer indices do not match: proposerIndex1=${header1.proposerIndex} proposerIndex2=${header2.proposerIndex}`
    );
  }

  // verify headers are different
  if (ssz.phase0.BeaconBlockHeaderBigint.equals(header1, header2)) {
    throw new Error("ProposerSlashing headers are equal");
  }

  // verify the proposer is slashable
  const proposer = state.validators.getReadonly(header1.proposerIndex);
  if (!isSlashableValidator(proposer, state.epochCtx.epoch)) {
    throw new Error("ProposerSlashing proposer is not slashable");
  }

  // verify signatures
  if (verifySignatures) {
    const signatureSets = getProposerSlashingSignatureSets(state, proposerSlashing);
    for (let i = 0; i < signatureSets.length; i++) {
      if (!verifySignatureSet(signatureSets[i])) {
        throw new Error(`ProposerSlashing header${i + 1} signature invalid`);
      }
    }
  }
}
