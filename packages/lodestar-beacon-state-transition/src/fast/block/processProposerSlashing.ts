import {Signature} from "@chainsafe/bls";
import {BeaconState, ProposerSlashing} from "@chainsafe/lodestar-types";

import {DomainType} from "../../constants";
import {computeEpochAtSlot, computeSigningRoot, getDomain, isSlashableValidator} from "../../util";
import {EpochContext} from "../util";
import {slashValidator} from "./slashValidator";


export function processProposerSlashing(
  epochCtx: EpochContext,
  state: BeaconState,
  proposerSlashing: ProposerSlashing,
  verifySignatures = true,
): void {
  const config = epochCtx.config;
  const {BeaconBlockHeader} = config.types;
  const header1 = proposerSlashing.signedHeader1.message;
  const header2 = proposerSlashing.signedHeader2.message;

  // verify header slots match
  if (header1.slot !== header2.slot) {
    throw new Error(
      "ProposerSlashing slots do not match: " +
      `slot1=${header1.slot} slot2=${header2.slot}`
    );
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
    const pubkey = epochCtx.index2pubkey[header1.proposerIndex];
    [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].forEach((signedHeader, i) => {
      const domain = getDomain(
        config,
        state,
        DomainType.BEACON_PROPOSER,
        computeEpochAtSlot(config, signedHeader.message.slot)
      );
      const signingRoot = computeSigningRoot(config, BeaconBlockHeader, signedHeader.message, domain);
      if (!pubkey.verifyMessage(
        Signature.fromCompressedBytes(signedHeader.signature.valueOf() as Uint8Array),
        signingRoot
      )) {
        throw new Error(`ProposerSlashing header${i + 1} signature invalid`);
      }
    });
  }
  slashValidator(epochCtx, state, header1.proposerIndex);
}
