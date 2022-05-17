import {NetworkName} from "@chainsafe/lodestar-config/networks.js";

export function getInfuraBeaconUrl(network: NetworkName): string {
  const INFURA_ETH2_CREDENTIALS = process.env.INFURA_ETH2_CREDENTIALS;
  if (!INFURA_ETH2_CREDENTIALS) {
    throw Error("Must set ENV INFURA_ETH2_CREDENTIALS");
  }

  return `https://${INFURA_ETH2_CREDENTIALS}@eth2-beacon-${network}.infura.io`;
}
