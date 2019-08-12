import {BeaconBlock, BeaconState, IndexedAttestation, Shard, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BeaconDb} from "../../../db/api";
import {assembleAttestationData} from "./data";

export async function assembleAttestation(
  config: IBeaconConfig,
  db: BeaconDb,
  state: BeaconState,
  headBlock: BeaconBlock,
  slot: Slot,
  shard: Shard): Promise<IndexedAttestation> {

  while(state.slot < slot) {
    state.slot++;
  }

  return {
    custodyBit0Indices: [],
    custodyBit1Indices: [],
    data: await assembleAttestationData(config, db, state, headBlock, shard),
    signature: undefined
  };

}
