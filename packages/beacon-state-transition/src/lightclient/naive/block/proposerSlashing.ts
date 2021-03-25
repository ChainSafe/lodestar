/**
 * @module chain/stateTransition/block
 */

import {phase0, lightclient} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";
import {isValidProposerSlashing} from "../../../util";
import {slashValidator} from "../../state_mutators";

export function processProposerSlashing(
  config: IBeaconConfig,
  state: lightclient.BeaconState,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  assert.true(isValidProposerSlashing(config, state, proposerSlashing, verifySignatures), "Invalid proposer slashing");
  slashValidator(config, state, proposerSlashing.signedHeader1.message.proposerIndex);
}
