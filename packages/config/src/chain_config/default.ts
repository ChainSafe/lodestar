import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {ChainConfig} from "./types.js";
import {chainConfig as mainnet} from "./presets/mainnet.js";
import {chainConfig as minimal} from "./presets/minimal.js";

let defaultChainConfig: ChainConfig;

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
