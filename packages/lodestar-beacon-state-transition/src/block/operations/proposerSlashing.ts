/**
 * @module chain/stateTransition/block
 */

import {BeaconState, ProposerSlashing,} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {slashValidator, isValidProposerSlashing} from "../../util";

export function processProposerSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  proposerSlashing: ProposerSlashing,
  verifySignatures = true,
): void {
  assert.true(isValidProposerSlashing(config, state, proposerSlashing, verifySignatures), "invalid proposer slashing");
  slashValidator(config, state, proposerSlashing.signedHeader1.message.proposerIndex);
}
