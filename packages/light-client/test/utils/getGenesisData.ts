import {ApiError, getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {NetworkName} from "@lodestar/config/networks.js";

// To populate packages/light-client/src/networks.ts
//
// ```
// INFURA_ETH2_CREDENTIALS=<user>:<secret> ./node_modules/.bin/ts-node test/getGenesisData.ts
// ```

/* eslint-disable no-console */

const networksInInfura: NetworkName[] = ["mainnet", "goerli"];

async function getGenesisData(): Promise<void> {
  for (const network of networksInInfura) {
    const baseUrl = getInfuraBeaconUrl(network);
    const api = getClient({baseUrl}, {config});
    const res = await api.beacon.getGenesis();
    ApiError.assert(res);
    console.log(network, {
      genesisTime: Number(res.response.data.genesisTime),
      genesisValidatorsRoot: "0x" + Buffer.from(res.response.data.genesisValidatorsRoot as Uint8Array).toString("hex"),
    });
  }
}

function getInfuraBeaconUrl(network: NetworkName): string {
  const INFURA_ETH2_CREDENTIALS = process.env.INFURA_ETH2_CREDENTIALS;
  if (!INFURA_ETH2_CREDENTIALS) {
    throw Error("Must set ENV INFURA_ETH2_CREDENTIALS");
  }

  return `https://${INFURA_ETH2_CREDENTIALS}@eth2-beacon-${network}.infura.io`;
}

getGenesisData().catch((e) => {
  console.error(e);
  process.exit(1);
});
