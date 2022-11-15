import path from "node:path";
import {getClient} from "@lodestar/api";
import {Lightclient} from "@lodestar/light-client";
import {fromHexString} from "@chainsafe/ssz";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {initializeExecutionEngine, ExecutionEngineOpts} from "@lodestar/light-client/execution";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {getGlobalPaths} from "../../paths/global.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {ExecutionEngineArgs} from "../../options/beaconNodeOptions/execution.js";
import * as execution from "../../options/beaconNodeOptions/execution.js";
import {ILightClientArgs} from "./options.js";

export async function lightclientHandler(args: ILightClientArgs & ExecutionEngineArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);
  const globalPaths = getGlobalPaths(args, network);

  const logger = getCliLogger(args, {defaultLogFilepath: path.join(globalPaths.dataDir, "lightclient.log")}, config);
  const {beaconApiUrl, checkpointRoot} = args;
  const api = getClient({baseUrl: beaconApiUrl}, {config});
  const {data: genesisData} = await api.beacon.getGenesis();

  const lightClientRestTransport = new LightClientRestTransport(api, api.lightclient.getStateProof);
  const parseArgs: ExecutionEngineOpts = execution.parseArgs(args) as ExecutionEngineOpts;
  const executionEngine = initializeExecutionEngine(parseArgs, {
    signal: new AbortController().signal,
  });
  const client = await Lightclient.initializeFromCheckpointRoot({
    config,
    logger,
    beaconApiUrl,
    genesisData: {
      genesisTime: Number(genesisData.genesisTime),
      genesisValidatorsRoot: genesisData.genesisValidatorsRoot,
    },
    checkpointRoot: fromHexString(checkpointRoot),
    transport: lightClientRestTransport,
    executionEngine,
  });

  client.start();
}
