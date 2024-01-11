/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {ChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

export const goerliChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "goerli",

  // Ethereum Goerli testnet
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,
  // Prater test deposit contract on Goerli Testnet
  DEPOSIT_CONTRACT_ADDRESS: b("0xff50ed3d0ec03aC01D4C79aAd74928BFF48a7b2b"),

  // Mar-01-2021 08:53:32 AM +UTC
  MIN_GENESIS_TIME: 1614588812,
  // Prater area code (Vienna)
  GENESIS_FORK_VERSION: b("0x00001020"),
  // Customized for Prater: 1919188 seconds (Mar-23-2021 02:00:00 PM +UTC)
  GENESIS_DELAY: 1919188,

  // Transition
  // Expected August 10, 2022
  TERMINAL_TOTAL_DIFFICULTY: BigInt("10790000"),

  // Forking
  ALTAIR_FORK_VERSION: b("0x01001020"),
  ALTAIR_FORK_EPOCH: 36660,
  // Bellatrix
  BELLATRIX_FORK_VERSION: b("0x02001020"),
  BELLATRIX_FORK_EPOCH: 112260,
  // Capella
  CAPELLA_FORK_VERSION: b("0x03001020"),
  CAPELLA_FORK_EPOCH: 162304,
  // Deneb
  DENEB_FORK_VERSION: b("0x04001020"),
  DENEB_FORK_EPOCH: 231680,
};
