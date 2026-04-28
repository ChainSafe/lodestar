import {ChainConfig} from "@lodestar/config";
import {mainnetChainConfig, minimalChainConfig} from "@lodestar/config/configs";
import {gnosisChainConfig} from "@lodestar/config/networks";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";

// Dev network will run from electra through fulu immediately
const devConfig: Partial<ChainConfig> = {
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 1,
};

let chainConfig: ChainConfig;
switch (ACTIVE_PRESET) {
  case PresetName.mainnet:
    chainConfig = {...mainnetChainConfig, ...devConfig};
    break;
  case PresetName.minimal:
    chainConfig = {...minimalChainConfig, ...devConfig};
    break;
  case PresetName.gnosis:
    chainConfig = {...gnosisChainConfig, ...devConfig};
    break;
  default:
    throw Error(`Preset ${ACTIVE_PRESET} not supported with dev command`);
}

export {chainConfig};

export const genesisFileUrl = null;
export const genesisStateRoot = null;
export const bootnodesFileUrl = null;
export const bootEnrs = [];
