import {goerliChainConfig as chainConfig} from "@lodestar/config/networks";
import {NetworkData} from "./index.js";

export function getNetworkData(): NetworkData {
  return {
    chainConfig,
    depositContractDeployBlock: 4367322,
    genesisFileUrl: "https://raw.githubusercontent.com/eth2-clients/eth2-testnets/master/shared/prater/genesis.ssz",
    bootnodesFileUrl:
      "https://raw.githubusercontent.com/eth2-clients/eth2-testnets/master/shared/prater/bootstrap_nodes.txt",
    bootEnrs: [],
  };
}
