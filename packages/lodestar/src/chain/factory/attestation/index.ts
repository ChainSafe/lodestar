import {Attestation, BeaconBlock, BeaconState, Shard, Slot, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IBeaconDb} from "../../../db/api";
import {assembleAttestationData} from "./data";
import {BitList} from "@chainsafe/bit-utils";
import {computeEpochOfSlot, getCrosslinkCommittee} from "../../stateTransition/util";
import {intDiv} from "@chainsafe/eth2.0-utils";

export async function assembleAttestation(
  {config, db}: {config: IBeaconConfig; db: IBeaconDb},
  state: BeaconState,
  headBlock: BeaconBlock,
  validatorIndex: ValidatorIndex,
  shard: Shard,
  slot: Slot): Promise<Attestation> {
  while(state.slot < slot) {
    state.slot++;
  }

  const committee = getCrosslinkCommittee(config, state, computeEpochOfSlot(config, slot), shard);
  const aggregationBits = getAggregationBits(committee, validatorIndex);
  const custodyBits = getEmptyBitList(committee.length);
  try {
    const data = await assembleAttestationData(config, db, state, headBlock, shard);
    return {
      aggregationBits,
      custodyBits,
      data,
      signature: undefined
    };
  } catch (e) {
    throw e;
  }
}

export function getAggregationBits(committee: ValidatorIndex[], validatorIndex: ValidatorIndex): BitList {
  const aggregationBits = getEmptyBitList(committee.length);
  committee.forEach((committeeValidator, index) => {
    if(committeeValidator === validatorIndex) {
      aggregationBits.setBit(index, true);
    }
  });
  return aggregationBits;
}

export function getEmptyBitList(length: number): BitList {
  return BitList.fromBitfield(
    Buffer.alloc(intDiv(length + 7, 8)),
    length
  );
}
