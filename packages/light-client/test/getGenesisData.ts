import {getClient} from "@chainsafe/lodestar-api";
import {config} from "@chainsafe/lodestar-config/default";
import {getInfuraBeaconUrl} from "@chainsafe/lodestar-beacon-state-transition/test/perf/infura";
import {NetworkName} from "@chainsafe/lodestar-config/networks";

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
    const api = getClient(config, {baseUrl});
    const {data: genesis} = await api.beacon.getGenesis();
    console.log(network, {
      genesisTime: Number(genesis.genesisTime),
      genesisValidatorsRoot: "0x" + Buffer.from(genesis.genesisValidatorsRoot as Uint8Array).toString("hex"),
    });
  }
}

getGenesisData().catch((e) => {
  console.error(e);
  process.exit(1);
});
