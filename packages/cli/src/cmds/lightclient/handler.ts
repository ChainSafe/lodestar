import path from "node:path";
import {ApiError, getClient} from "@lodestar/api";
import {Lightclient} from "@lodestar/light-client";
import {fromHexString} from "@chainsafe/ssz";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {getGlobalPaths} from "../../paths/global.js";
import {GlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {ILightClientArgs} from "./options.js";

export async function lightclientHandler(args: ILightClientArgs & GlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);
  const globalPaths = getGlobalPaths(args, network);

  const {logger} = getCliLogger(args, {defaultLogFilepath: path.join(globalPaths.dataDir, "lightclient.log")}, config);
  const {beaconApiUrl, checkpointRoot} = args;
  const api = getClient({baseUrl: beaconApiUrl}, {config});
  const res = await api.beacon.getGenesis();
  ApiError.assert(res, "Can not fetch genesis data");

  const client = await Lightclient.initializeFromCheckpointRoot({
    config,
    logger,
    genesisData: {
      genesisTime: Number(res.response.data.genesisTime),
      genesisValidatorsRoot: res.response.data.genesisValidatorsRoot,
    },
    checkpointRoot: fromHexString(checkpointRoot),
    transport: new LightClientRestTransport(api),
  });

  client.start();
}
