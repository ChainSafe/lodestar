import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {params} from "@chainsafe/lodestar-params/lib/presets/mainnet";

export const medalla = {
  providerUrl: "https://goerli.prylabs.net",
  depositBlock: 3085928,
  // Medalla optimized blocks for quick testing
  blockWithDepositActivity: 3124889,
};

/**
 * Medalla specs
 */
export function getMedallaConfig(): IBeaconConfig {
  const config = createIBeaconConfig(params);
  config.params.DEPOSIT_NETWORK_ID = 5;
  config.params.DEPOSIT_CONTRACT_ADDRESS = Buffer.from("07b39F4fDE4A38bACe212b546dAc87C58DfE3fDC", "hex");
  config.params.MIN_GENESIS_TIME = 1596546000;
  config.params.GENESIS_DELAY = 172800;
  return config;
}
