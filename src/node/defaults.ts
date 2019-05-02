import eth1Defaults from "../eth1/defaults";
import p2pDefaults from "../p2p/defaults";

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
  p2p: p2pDefaults
};
