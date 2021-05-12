import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {isSlashableValidator} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {getProposerSlashingSignatureSets} from "../../allForks/signatureSets";
import {slashValidator} from "./slashValidator";
import {verifySignatureSet} from "../../util/signatureSets";

export function processProposerSlashing(
  state: CachedBeaconState<altair.BeaconState>,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  const {config, epochCtx} = state;
  const {BeaconBlockHeader} = config.types.phase0;
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
    for (const [i, signatureSet] of getProposerSlashingSignatureSets(
      state as CachedBeaconState<allForks.BeaconState>,
      proposerSlashing
    ).entries()) {
      if (!verifySignatureSet(signatureSet)) {
        throw new Error(`ProposerSlashing header${i + 1} signature invalid`);
      }
    }
  }

  slashValidator(state, header1.proposerIndex);
}
