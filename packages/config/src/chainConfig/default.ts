import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {ChainConfig} from "./types.js";
import {chainConfig as mainnet} from "./configs/mainnet.js";
import {chainConfig as minimal} from "./configs/minimal.js";

let defaultChainConfig: ChainConfig;

switch (ACTIVE_PRESET) {
  case PresetName.minimal:
    defaultChainConfig = minimal;
    break;
  case PresetName.mainnet:
    defaultChainConfig = mainnet;
    break;
  default:
    defaultChainConfig = mainnet;
}

export {defaultChainConfig};
