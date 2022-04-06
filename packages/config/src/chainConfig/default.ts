import {ACTIVE_PRESET, PresetName} from "@chainsafe/lodestar-params";
import {IChainConfig} from "./types.js";
import {chainConfig as mainnet} from "./presets/mainnet.js";
import {chainConfig as minimal} from "./presets/minimal.js";

let defaultChainConfig: IChainConfig;

switch (ACTIVE_PRESET) {
  case PresetName.minimal:
    defaultChainConfig = minimal;
    break;
  case PresetName.mainnet:
  default:
    defaultChainConfig = mainnet;
    break;
}

export {defaultChainConfig};
