import {readFileSync} from "fs";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {deserialize} from "@chainsafe/ssz";
import {interopDeposits} from "./deposits";
import {fromYaml, IProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";
import {loadYamlFile} from "@chainsafe/eth2.0-utils/lib/nodejs";



// either "genesisTime,validatorCount" or "genesisState.fileext"
export function quickStartOptionToState(
  config: IBeaconConfig,
  tree: IProgressiveMerkleTree,
  option: string
): BeaconState {
  const fileExt = /.(ssz|ya?ml)$/.exec(option);
  if (!fileExt) {
    throw new Error("invalid quick start options");
  }
  if (fileExt[1] === "ssz") {
    const deserialized = deserialize<BeaconState>(config.types.BeaconState, readFileSync(option));
    interopDeposits(config, tree, deserialized.validators.length);
    return deserialized;
  } else {
    return fromYaml<BeaconState>(config.types.BeaconState, loadYamlFile(option));
  }
}
