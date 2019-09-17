import {readFileSync} from "fs";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {deserialize} from "@chainsafe/ssz";
import {loadYamlFile} from "@chainsafe/eth2.0-spec-test-util";

import {expandYamlValue} from "../util/expandYamlValue";
import {quickStartState} from "./state";

// either "genesisTime,validatorCount" or "genesisState.fileext"
export function quickStartOptionToState(config: IBeaconConfig, option: string): BeaconState {
  const quickStartOpts = option.split(",");
  if (quickStartOpts.length === 2) {
    return quickStartState(
      config,
      parseInt(quickStartOpts[0]),
      parseInt(quickStartOpts[1])
    );
  }
  const fileExt = /.(ssz|ya?ml)$/.exec(option);
  if (!fileExt) {
    throw new Error("invalid quick start options");
  }
  if (fileExt[1] === "ssz") {
    return deserialize(readFileSync(option), config.types.BeaconState);
  } else {
    return expandYamlValue(loadYamlFile(option), config.types.BeaconState);
  }
}
