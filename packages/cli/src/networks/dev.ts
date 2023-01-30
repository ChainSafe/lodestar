import {minimalChainConfig, mainnetChainConfig} from "@lodestar/config/presets";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {NetworkData} from "./index.js";

export function getNetworkData(): NetworkData {
  let chainConfig;
  switch (ACTIVE_PRESET) {
    case PresetName.mainnet:
      chainConfig = mainnetChainConfig;
      break;
    case PresetName.minimal:
      chainConfig = minimalChainConfig;
      break;
    default:
      throw Error(`Preset ${ACTIVE_PRESET} not supported with dev command`);
  }

  return {
    chainConfig,
    depositContractDeployBlock: 0,
    genesisFileUrl: null,
    bootnodesFileUrl: null,
    bootEnrs: [],
  };
}
