import {allForks, altair, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assertValidAttesterSlashing} from "../../phase0/block/processAttesterSlashing";
import {isSlashableValidator} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {slashValidator} from "./slashValidator";

export function processAttesterSlashing(
  state: CachedBeaconState<altair.BeaconState>,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  assertValidAttesterSlashing(state as CachedBeaconState<allForks.BeaconState>, attesterSlashing, verifySignatures);

  let slashedAny = false;
  const attSet1 = new Set(attesterSlashing.attestation1.attestingIndices);
  const attSet2 = new Set(attesterSlashing.attestation2.attestingIndices);
  const indices: ValidatorIndex[] = [];
  for (const i of attSet1.values()) {
    if (attSet2.has(i)) {
      indices.push(i);
    }
  }
  const validators = state.validators;
  for (const index of indices.sort((a, b) => a - b)) {
    if (isSlashableValidator(validators[index], state.epochCtx.currentShuffling.epoch)) {
      slashValidator(state, index);
      slashedAny = true;
    }
  }
  if (!slashedAny) {
    throw new Error("AttesterSlashing did not result in any slashings");
  }
}
