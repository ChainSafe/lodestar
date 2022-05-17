import {getClient} from "@chainsafe/lodestar-api";
import {config} from "@chainsafe/lodestar-config/default";
import {NetworkName} from "@chainsafe/lodestar-config/networks.js";

// To populate packages/light-client/src/networks.ts
//
// ```
// INFURA_ETH2_CREDENTIALS=<user>:<secret> ./node_modules/.bin/ts-node test/getGenesisData.ts
// ```

/* eslint-disable no-console */

const networksInInfura: NetworkName[] = ["mainnet", "prater"];

async function getGenesisData(): Promise<void> {
  for (const network of networksInInfura) {
    const baseUrl = getInfuraBeaconUrl(network);
    const api = getClient({baseUrl}, {config});
    const {data: genesis} = await api.beacon.getGenesis();
    console.log(network, {
      genesisTime: Number(genesis.genesisTime),
      genesisValidatorsRoot: "0x" + Buffer.from(genesis.genesisValidatorsRoot as Uint8Array).toString("hex"),
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
