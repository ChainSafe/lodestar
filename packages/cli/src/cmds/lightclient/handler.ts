import {getClient} from "@chainsafe/lodestar-api";
import {Lightclient} from "@chainsafe/lodestar-light-client";
import {fromHexString} from "@chainsafe/ssz";
import {getBeaconConfigFromArgs} from "../../config/beaconParams";
import {IGlobalArgs} from "../../options";
import {getCliLogger, initBLS} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {ILightClientArgs} from "./options";

export async function lightclientHandler(args: ILightClientArgs & IGlobalArgs): Promise<void> {
  await initBLS();

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
