import {gnosisChainConfig} from "@lodestar/config/networks";
import {minimalChainConfig, mainnetChainConfig} from "@lodestar/config/presets";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";

let chainConfig;
switch (ACTIVE_PRESET) {
  case PresetName.mainnet:
    chainConfig = mainnetChainConfig;
    break;
  case PresetName.minimal:
    chainConfig = minimalChainConfig;
    break;
  case PresetName.gnosis:
    chainConfig = gnosisChainConfig;
    break;
  default:
    throw Error(`Preset ${ACTIVE_PRESET} not supported with dev command`);
}

export {chainConfig};

export const depositContractDeployBlock = 0;
export const genesisFileUrl = null;
export const bootnodesFileUrl = null;
export const bootEnrs = [];
