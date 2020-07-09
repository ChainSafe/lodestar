import {Attestation, BeaconBlock, BeaconState, Slot, ValidatorIndex, CommitteeIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db/api";
import {assembleAttestationData} from "./data";
import {getBeaconCommittee} from "@chainsafe/lodestar-beacon-state-transition";
import {EMPTY_SIGNATURE} from "../../../constants";
import {TreeBacked} from "@chainsafe/ssz";

export async function assembleAttestation(
  {config, db}: {config: IBeaconConfig; db: IBeaconDb},
  state: TreeBacked<BeaconState>,
  headBlock: BeaconBlock,
  validatorIndex: ValidatorIndex,
  index: CommitteeIndex,
  slot: Slot): Promise<Attestation> {
  const committee = getBeaconCommittee(config, state, slot, index);
  if(committee.find((c) => c === validatorIndex) === undefined) {
    throw new Error("Validator not in given committee");
  }
  const aggregationBits = getAggregationBits(committee, validatorIndex);
  const data = await assembleAttestationData(config, db, state, headBlock, slot, index);
  console.log({validatorIndex, slot, committeeIndex: index, committee});
  console.log("produced attestation", {
    aggregationBits,
    data,
    signature: EMPTY_SIGNATURE
  });
  return {
    aggregationBits,
    data,
    signature: EMPTY_SIGNATURE
  };
}

export function getAggregationBits(committee: ValidatorIndex[], validatorIndex: ValidatorIndex): boolean[] {
  return Array.from({length: committee.length}, (_, i) => committee[i] === validatorIndex);
}
