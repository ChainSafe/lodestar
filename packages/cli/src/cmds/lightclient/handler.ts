import {getClient} from "@chainsafe/lodestar-api";
import {Lightclient} from "@chainsafe/lodestar-light-client";
import {fromHexString} from "@chainsafe/ssz";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {ILightClientArgs} from "./options.js";

export async function lightclientHandler(args: ILightClientArgs & IGlobalArgs): Promise<void> {
  const config = getBeaconConfigFromArgs(args);
  const beaconPaths = getBeaconPaths(args);
  const logger = getCliLogger(args, beaconPaths, config);
  const {beaconApiUrl, checkpointRoot} = args;
  const api = getClient({baseUrl: beaconApiUrl}, {config});
  const {data: genesisData} = await api.beacon.getGenesis();

  const client = await Lightclient.initializeFromCheckpointRoot({
    config,
    logger,
    beaconApiUrl,
    genesisData: {
      genesisTime: Number(genesisData.genesisTime),
      genesisValidatorsRoot: genesisData.genesisValidatorsRoot,
    },
    checkpointRoot: fromHexString(checkpointRoot),
  });

  client.start();
}
