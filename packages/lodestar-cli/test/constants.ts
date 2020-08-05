import { TestnetName } from "../src/testnets";

export const testnetName = "medalla";
export const testnetDir = ".medalla";
export const rootDir = ".tmp";
export const initDefaults = {
  rootDir,
  preset: "mainnet",
  testnet: testnetName as TestnetName,
  paramsFile: `${rootDir}/config.yaml`,
  params: {
    "DEPOSIT_CHAIN_ID": 5,
    "DEPOSIT_NETWORK_ID": 5
  },
}