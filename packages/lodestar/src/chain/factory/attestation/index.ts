import {Attestation, BeaconBlock, BeaconState, Slot, ValidatorIndex, CommitteeIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db/api";
import {assembleAttestationData} from "./data";
import {getBeaconCommittee} from "@chainsafe/lodestar-beacon-state-transition";
import {EMPTY_SIGNATURE} from "../../../constants";

export async function assembleAttestation(
  {config, db}: {config: IBeaconConfig; db: IBeaconDb},
  state: BeaconState,
  headBlock: BeaconBlock,
  validatorIndex: ValidatorIndex,
  index: CommitteeIndex,
  slot: Slot): Promise<Attestation> {
  const committee = getBeaconCommittee(config, state, slot, index);
  const aggregationBits = getAggregationBits(committee, validatorIndex);
  const data = await assembleAttestationData(config, db, state, headBlock, slot, index);
  return {
    aggregationBits,
    data,
    signature: EMPTY_SIGNATURE
  };
}

export function getAggregationBits(committee: ValidatorIndex[], validatorIndex: ValidatorIndex): boolean[] {
  return Array.from({length: committee.length}, (_, i) => committee[i] === validatorIndex);
}
