import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../../allForks/util";
import {slashValidator} from "./slashValidator";
import {assertValidProposerSlashing} from "../../phase0/block/processProposerSlashing";

export function processProposerSlashing(
  state: CachedBeaconState<altair.BeaconState>,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  assertValidProposerSlashing(state as CachedBeaconState<allForks.BeaconState>, proposerSlashing, verifySignatures);

  slashValidator(state, proposerSlashing.signedHeader1.message.proposerIndex);
}
