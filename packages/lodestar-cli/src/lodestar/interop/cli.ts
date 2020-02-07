import {readFileSync} from "fs";
import {TreeBackedValue, List} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState, Root} from "@chainsafe/eth2.0-types";
import {interopDeposits} from "./deposits";



// either "genesisTime,validatorCount" or "genesisState.fileext"
export function quickStartOptionToState(
  config: IBeaconConfig,
  depositDataRootList: TreeBackedValue<List<Root>>,
  option: string
): BeaconState {
  const fileExt = /.(ssz)$/.exec(option);
  if (!fileExt) {
    throw new Error("invalid quick start options");
  }
  const deserialized = config.types.BeaconState.deserialize(readFileSync(option));
  interopDeposits(config, depositDataRootList, deserialized.validators.length);
  return deserialized;
}
