/* eslint-disable @typescript-eslint/naming-convention */
import {IBeaconParamsUnparsed} from "../config/types";

/* eslint-disable max-len */

export const beaconParams: IBeaconParamsUnparsed = {
  // Ethereum Goerli testnet
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,
  // Prater test deposit contract on Goerli Testnet
  DEPOSIT_CONTRACT_ADDRESS: "0xff50ed3d0ec03aC01D4C79aAd74928BFF48a7b2b",

  // Mar-01-2021 08:53:32 AM +UTC
  MIN_GENESIS_TIME: 1614588812,
  GENESIS_DELAY: 1919188,
  GENESIS_FORK_VERSION: "0x00001020",
};

export const depositContractDeployBlock = 4367322;
export const genesisFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-testnets/master/shared/prater/genesis.ssz";
export const bootnodesFileUrl =
  "https://raw.githubusercontent.com/eth2-clients/eth2-testnets/master/shared/prater/bootstrap_nodes.txt";

export const bootEnrs = [];
