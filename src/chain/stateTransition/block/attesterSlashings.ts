import assert from "assert";

import {serialize} from "@chainsafe/ssz";

import {
  AttestationData,
  BeaconBlock,
  BeaconState,
} from "../../../types";

import {
  MAX_ATTESTER_SLASHINGS,
} from "../../../constants";

import {
  getCurrentEpoch,
  isDoubleVote,
  isSurroundVote,
  verifySlashableAttestation,
} from "../../helpers/stateTransitionHelpers";

import {
  slashValidator,
} from "../../helpers/validatorStatus";

export default function processAttesterSlashings(state: BeaconState, block: BeaconBlock): void {
  assert(block.body.attesterSlashings.length <= MAX_ATTESTER_SLASHINGS);
  for (const attesterSlashing of block.body.attesterSlashings) {
    const slashableAttestation1 = attesterSlashing.slashableAttestation1;
    const slashableAttestation2 = attesterSlashing.slashableAttestation2;

    assert(!serialize(slashableAttestation1.data, AttestationData).equals(serialize(slashableAttestation2.data, AttestationData)));
    assert(isDoubleVote(slashableAttestation1.data, slashableAttestation2.data) ||
      isSurroundVote(slashableAttestation1.data, slashableAttestation2.data));
    assert(verifySlashableAttestation(state, slashableAttestation1));
    assert(verifySlashableAttestation(state, slashableAttestation2));
    const slashableIndices = slashableAttestation1.validatorIndices
      .filter((validatorIndex1) => (
        slashableAttestation2.validatorIndices.find((validatorIndex2) => validatorIndex1 === validatorIndex2) &&
        state.validatorRegistry[validatorIndex1].slashedEpoch > getCurrentEpoch(state)
      ));
    assert(slashableIndices.length >= 1);
    slashableIndices.forEach((index) => slashValidator(state, index));
  }
}
