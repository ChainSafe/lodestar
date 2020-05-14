import {readFileSync} from "fs";
import {TreeBacked, List} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Root} from "@chainsafe/lodestar-types";
import {interopDeposits} from "./deposits";



// either "genesisTime,validatorCount" or "genesisState.fileext"
export function quickStartOptionToState(
  config: IBeaconConfig,
  depositDataRootList: TreeBacked<List<Root>>,
  option: string
): BeaconState {
  const fileExt = /.(ssz)$/.exec(option);
  if (!fileExt) {
    throw new Error("invalid quick start options");
  }
  const deserialized = config.types.BeaconState.tree.deserialize(readFileSync(option));
  interopDeposits(config, depositDataRootList, deserialized.validators.length);
  return deserialized;
}
