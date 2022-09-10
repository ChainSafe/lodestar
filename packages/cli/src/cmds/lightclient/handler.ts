import {getClient} from "@lodestar/api";
import {Lightclient} from "@lodestar/light-client";
import {fromHexString} from "@chainsafe/ssz";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {ILightClientArgs} from "./options.js";
import {getLightclientPaths} from "./paths.js";

export async function lightclientHandler(args: ILightClientArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  const beaconPaths = getBeaconPaths(args, network);
  const lightclientPaths = getLightclientPaths(args, network);

  const logger = getCliLogger(args, {...beaconPaths, logFile: lightclientPaths.logFile}, config);
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
