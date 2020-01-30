import {Attestation, BeaconBlock, BeaconState, Slot, ValidatorIndex, CommitteeIndex} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IBeaconDb} from "../../../db/api";
import {assembleAttestationData} from "./data";
import {getBeaconCommittee} from "@chainsafe/eth2.0-state-transition";
import {intDiv} from "@chainsafe/eth2.0-utils";

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
    signature: undefined
  };
}

export function getAggregationBits(committee: ValidatorIndex[], validatorIndex: ValidatorIndex): boolean[] {
  return Array.from({length: committee.length}, (_, i) => committee[i] === validatorIndex);
}
