import {verify} from "@chainsafe/bls";
import {BeaconState, ProposerSlashing} from "@chainsafe/lodestar-types";

import {DomainType} from "../../constants";
import {isSlashableValidator, getDomain, computeEpochAtSlot, computeSigningRoot} from "../../util";
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
    throw new Error();
  }
  // verify header proposer indices match
  if (header1.proposerIndex !== header2.proposerIndex) {
    throw new Error();
  }
  // verify headers are different
  if (BeaconBlockHeader.equals(header1, header2)) {
    throw new Error();
  }
  // verify the proposer is slashable
  const proposer = state.validators[header1.proposerIndex];
  if (!isSlashableValidator(proposer, epochCtx.currentShuffling.epoch)) {
    throw new Error();
  }
  // verify signatures
  if (verifySignatures) {
    [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].forEach((signedHeader) => {
      const domain = getDomain(
        config,
        state,
        DomainType.BEACON_PROPOSER,
        computeEpochAtSlot(config, signedHeader.message.slot)
      );
      const signingRoot = computeSigningRoot(config, BeaconBlockHeader, signedHeader.message, domain);
      if (!verify(
        proposer.pubkey.valueOf() as Uint8Array,
        signingRoot,
        signedHeader.signature.valueOf() as Uint8Array
      )) {
        throw new Error();
      }
    });
  }
  slashValidator(epochCtx, state, header1.proposerIndex);
}
