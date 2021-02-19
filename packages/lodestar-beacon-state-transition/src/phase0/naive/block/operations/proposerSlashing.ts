/**
 * @module chain/stateTransition/block
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {slashValidator, isValidProposerSlashing} from "../../../../util";

export function processProposerSlashing(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  assert.true(isValidProposerSlashing(config, state, proposerSlashing, verifySignatures), "Invalid proposer slashing");
  slashValidator(config, state, proposerSlashing.signedHeader1.message.proposerIndex);
}
