import {TreeBacked} from "@chainsafe/ssz";
import {Attestation, BeaconState, Slot, ValidatorIndex, CommitteeIndex} from "@chainsafe/lodestar-types";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

import {assembleAttestationData} from "./data";
import {EMPTY_SIGNATURE} from "../../../constants";

export async function assembleAttestation(
  epochCtx: EpochContext,
  state: TreeBacked<BeaconState>,
  headBlockRoot: Uint8Array,
  validatorIndex: ValidatorIndex,
  index: CommitteeIndex,
  slot: Slot): Promise<Attestation> {
  const committee = epochCtx.getBeaconCommittee(slot, index);
  if(committee.find((c) => c === validatorIndex) === undefined) {
    throw new Error("Validator not in given committee");
  }
  const aggregationBits = getAggregationBits(committee, validatorIndex);
  const data = await assembleAttestationData(epochCtx.config, state, headBlockRoot, slot, index);
  return {
    aggregationBits,
    data,
    signature: EMPTY_SIGNATURE
  };
}

export function getAggregationBits(committee: ValidatorIndex[], validatorIndex: ValidatorIndex): boolean[] {
  return Array.from({length: committee.length}, (_, i) => committee[i] === validatorIndex);
}
