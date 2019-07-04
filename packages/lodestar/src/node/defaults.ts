/**
 * @module node
 */

import eth1Defaults from "../eth1/defaults";
import networkDefaults from "../network/defaults";

export default {
  chain: {
    chain: "mainnet",
  },
  db: {
    name: './lodestar-db'
  },
  rpc: {
    port: 9545
  },
  eth1: eth1Defaults,
  network: networkDefaults,
};
