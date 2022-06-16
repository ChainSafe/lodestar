/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {IChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

/* eslint-disable max-len */

export const sepoliaChainConfig: IChainConfig = {
  ...mainnet,

  // Ethereum Sepolia EL Testnet
  DEPOSIT_CHAIN_ID: 11155111,
  DEPOSIT_NETWORK_ID: 11155111,
  // Sepolia test-deposit contract on Sepolia EL Testnet
  DEPOSIT_CONTRACT_ADDRESS: b("0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D"),

  // Sunday, June 19, 2022 2:00:00 PM +UTC
  MIN_GENESIS_TIME: 1655647200,
  // Sepolia genesis fork version
  GENESIS_FORK_VERSION: b("0x90000069"),
  // 86400 seconds (Monday, June 20, 2022 2:00:00 PM +UTC)
  GENESIS_DELAY: 86400,

  // Forking
  ALTAIR_FORK_VERSION: b("0x90000070"),
  ALTAIR_FORK_EPOCH: 50,
  // Bellatrix
  BELLATRIX_FORK_VERSION: b("0x90000071"),
  BELLATRIX_FORK_EPOCH: 100,
  // Capella
  // CAPELLA_FORK_VERSION: b("0x03001020"),
  // CAPELLA_FORK_EPOCH: Infinity,
  // Sharding
  SHARDING_FORK_VERSION: b("0x04001020"),
  SHARDING_FORK_EPOCH: Infinity,
};
