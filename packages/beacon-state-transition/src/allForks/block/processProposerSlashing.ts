import {phase0, ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {isSlashableValidator} from "../../util";
import {CachedBeaconStateAllForks} from "../../types";
import {getProposerSlashingSignatureSets} from "../../allForks/signatureSets";
import {slashValidatorAllForks} from "../../allForks/block/slashValidator";
import {verifySignatureSet} from "../../util/signatureSets";

/**
 * Process a ProposerSlashing operation. Initiates the exit of a validator, decreases the balance of the slashed
 * validator and increases the block proposer balance.
 *
 * PERF: Work depends on number of ProposerSlashing per block. On regular networks the average is 0 / block.
 */
export function processProposerSlashing(
  fork: ForkName,
  state: CachedBeaconStateAllForks,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  assertValidProposerSlashing(state as CachedBeaconStateAllForks, proposerSlashing, verifySignatures);

  slashValidatorAllForks(fork, state, proposerSlashing.signedHeader1.message.proposerIndex);
}

export function assertValidProposerSlashing(
  state: CachedBeaconStateAllForks,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  const {epochCtx} = state;
  const {BeaconBlockHeader} = ssz.phase0;
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
    for (const [i, signatureSet] of getProposerSlashingSignatureSets(
      state as CachedBeaconStateAllForks,
      proposerSlashing
    ).entries()) {
      if (!verifySignatureSet(signatureSet)) {
        throw new Error(`ProposerSlashing header${i + 1} signature invalid`);
      }
    }
  }
}
