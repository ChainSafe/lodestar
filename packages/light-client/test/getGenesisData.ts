import {getClient} from "@chainsafe/lodestar-api";
import {config} from "@chainsafe/lodestar-config/default";

// To populate packages/light-client/src/networks.ts
//
// ```
// ./node_modules/.bin/ts-node test/getGenesisData.ts
// ```

/* eslint-disable no-console */

const networksInInfura = ["mainnet", "prater", "pyrmont"];
const INFURA_CREDENTIALS = "1sla4tyOFn0bB1ohyCKaH2sLmHu:b8cdb9d881039fd04fe982a5ec57b0b8";

async function getGenesisData(): Promise<void> {
  for (const network of networksInInfura) {
    const baseUrl = `https://${INFURA_CREDENTIALS}@eth2-beacon-${network}.infura.io`;
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
