/**
 * @module chain/stateTransition/block
 */

import assert from "assert";

import {BeaconState, ProposerSlashing,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {slashValidator, isValidProposerSlashing} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.9.0/specs/core/0_beacon-chain.md#proposer-slashings

export function processProposerSlashing(
  config: IBeaconConfig,
  state: BeaconState,
  proposerSlashing: ProposerSlashing,
  verifySignatures = true,
): void {
  assert(isValidProposerSlashing(config, state, proposerSlashing, verifySignatures));
  slashValidator(config, state, proposerSlashing.proposerIndex);
}
