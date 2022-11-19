import path from "node:path";
import {getClient} from "@lodestar/api";
import {Lightclient} from "@lodestar/light-client";
import {fromHexString} from "@chainsafe/ssz";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {ExecutionEngineOpts, initializeExecutionEngine} from "@lodestar/engine-api-client";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {getGlobalPaths} from "../../paths/global.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger, onGracefulShutdown} from "../../util/index.js";
import {ExecutionEngineArgs} from "../../options/beaconNodeOptions/execution.js";
import {parseArgs} from "../../options/beaconNodeOptions/execution.js";
import {ILightClientArgs} from "./options.js";

export async function lightclientHandler(args: ILightClientArgs & ExecutionEngineArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);
  const globalPaths = getGlobalPaths(args, network);

  const logger = getCliLogger(args, {defaultLogFilepath: path.join(globalPaths.dataDir, "lightclient.log")}, config);
  const {beaconApiUrl, checkpointRoot} = args;
  const api = getClient({baseUrl: beaconApiUrl}, {config});
  const {data: genesisData} = await api.beacon.getGenesis();

  const abortController = new AbortController();
  onGracefulShutdown(async () => {
    abortController.abort();
  }, logger.info.bind(logger));

  const lightClientRestTransport = new LightClientRestTransport(api, api.proof.getStateProof);
  const executionEngineOpts: ExecutionEngineOpts = parseArgs(args);
  const executionEngine = initializeExecutionEngine(executionEngineOpts, {
    signal: abortController.signal,
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
    abortController,
  });
  abortController.signal.addEventListener("abort", () => client.stop(), {once: true});

  client.start();
}
