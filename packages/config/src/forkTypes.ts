/* eslint-disable @typescript-eslint/naming-convention */
import {AllForksSSZTypes, IBeaconSSZTypes} from "@chainsafe/lodestar-types";
import {ForkName} from "./interface";

/**
 * Index the ssz types that differ by fork
 * @returns A record of AllForksSSZTypes indexed by fork
 */
export function getForkTypesRecord(types: IBeaconSSZTypes): {[K in ForkName]: AllForksSSZTypes} {
  return {
    phase0: {
      BeaconBlockBody: types.phase0.BeaconBlockBody,
      BeaconBlock: types.phase0.BeaconBlock,
      SignedBeaconBlock: types.phase0.SignedBeaconBlock,
      BeaconState: types.phase0.BeaconState as AllForksSSZTypes["BeaconState"],
    },
    altair: {
      BeaconBlockBody: types.altair.BeaconBlockBody as AllForksSSZTypes["BeaconBlockBody"],
      BeaconBlock: types.altair.BeaconBlock as AllForksSSZTypes["BeaconBlock"],
      SignedBeaconBlock: types.altair.SignedBeaconBlock as AllForksSSZTypes["SignedBeaconBlock"],
      BeaconState: types.altair.BeaconState as AllForksSSZTypes["BeaconState"],
    },
  };
}
