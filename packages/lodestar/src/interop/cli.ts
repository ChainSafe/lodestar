import {readFileSync} from "fs";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {deserialize} from "@chainsafe/ssz";
import {loadYamlFile} from "@chainsafe/eth2.0-spec-test-util";

import {interopDeposits} from "./deposits";
import {expandYamlValue} from "../util/expandYamlValue";
import {quickStartState} from "./state";
import {IProgressiveMerkleTree} from "../util/merkleTree";

// either "genesisTime,validatorCount" or "genesisState.fileext"
export function quickStartOptionToState(config: IBeaconConfig, tree: IProgressiveMerkleTree, option: string): BeaconState {
  const quickStartOpts = option.split(",");
  if (quickStartOpts.length === 2) {
    return quickStartState(
      config,
      tree,
      parseInt(quickStartOpts[0]),
      parseInt(quickStartOpts[1])
    );
  }
  const fileExt = /.(ssz|ya?ml)$/.exec(option);
  if (!fileExt) {
    throw new Error("invalid quick start options");
  }
  if (fileExt[1] === "ssz") {
    let deserialized = deserialize(readFileSync(option), config.types.BeaconState);
    interopDeposits(config, tree, deserialized.validators.length);  
    return deserialized;
  } else {
    return expandYamlValue(loadYamlFile(option), config.types.BeaconState);
  }
}
