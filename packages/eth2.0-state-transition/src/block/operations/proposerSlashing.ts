/**
 * @module chain/stateTransition/block
 */

import assert from "assert";

import {BeaconState, ProposerSlashing,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {slashValidator, isValidProposerSlashing} from "../../util";

export function processProposerSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  proposerSlashing: ProposerSlashing,
  verifySignatures = true,
): void {
  assert(isValidProposerSlashing(config, state, proposerSlashing, verifySignatures));
  slashValidator(config, state, proposerSlashing.proposerIndex);
}
