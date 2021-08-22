/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {IChainConfig} from "..";
import {chainConfig as mainnet} from "../presets/mainnet";

/* eslint-disable max-len */

export const praterChainConfig: IChainConfig = {
  ...mainnet,

  // Ethereum Goerli testnet
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,
  // Prater test deposit contract on Goerli Testnet
  DEPOSIT_CONTRACT_ADDRESS: b("0xff50ed3d0ec03aC01D4C79aAd74928BFF48a7b2b"),

  // Mar-01-2021 08:53:32 AM +UTC
  MIN_GENESIS_TIME: 1614588812,
  GENESIS_DELAY: 1919188,
  GENESIS_FORK_VERSION: b("0x00001020"),
};
