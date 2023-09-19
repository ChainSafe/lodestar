import {writeFile} from "node:fs/promises";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {EL_ENGINE_BASE_PORT, SHARED_JWT_SECRET} from "../constants.js";
import {AtLeast, BeaconClient, BeaconGeneratorOptions, BeaconNode} from "../interfaces.js";
import {makeUniqueArray} from "../utils/index.js";
import {ensureDirectories} from "../utils/paths.js";
import {generateLighthouseBeaconNode} from "./lighthouse.js";
import {generateLodestarBeaconNode} from "./lodestar.js";

export async function createBeaconNode<B extends BeaconClient>(
  client: B,
  options: AtLeast<
    BeaconGeneratorOptions<B>,
    "id" | "paths" | "forkConfig" | "nodeIndex" | "genesisTime" | "runner"
  > & {
    genesisState?: BeaconStateAllForks;
  }
): Promise<BeaconNode> {
  const {runner, forkConfig: config, genesisState} = options;
  const clId = `${options.id}-${client}`;

  const opts: BeaconGeneratorOptions = {
    ...options,
    id: clId,
    genesisTime: options.genesisTime + config.GENESIS_DELAY,
    engineMock: options.engineMock ?? false,
    clientOptions: options.clientOptions ?? {},
    address: "127.0.0.1",
    engineUrls: options.engineUrls ?? [],
  };

  const metricServer = process.env.SIM_METRIC_SERVER_URL;
  if (metricServer) {
    const server = new URL(metricServer.startsWith("http") ? metricServer : `http://${metricServer}`);
    opts.metrics = {
      host: server.hostname,
      port: parseInt(server.port as string),
    };
  }

  await ensureDirectories(opts.paths);
  await writeFile(opts.paths.jwtsecretFilePath, SHARED_JWT_SECRET);

  // We have to wite the genesis state but can't do that without starting up
  // at least one EL node and getting ETH_HASH, so will do in startup
  //await writeFile(clPaths.genesisFilePath, this.genesisState);

  if (genesisState) {
    await writeFile(opts.paths.genesisFilePath, genesisState.serialize());
  }

  switch (client) {
    case BeaconClient.Lodestar: {
      return generateLodestarBeaconNode(
        {
          ...opts,
          address: "127.0.0.1",
          engineUrls:
            opts.engineUrls.length > 0
              ? makeUniqueArray([`http://127.0.0.1:${EL_ENGINE_BASE_PORT + opts.nodeIndex + 1}`, ...opts.engineUrls])
              : [`http://127.0.0.1:${EL_ENGINE_BASE_PORT + opts.nodeIndex + 1}`],
        },
        runner
      );
    }
    case BeaconClient.Lighthouse: {
      return generateLighthouseBeaconNode(
        {
          ...opts,
          address: runner.getNextIp(),
          engineUrls:
            opts.engineUrls.length > 0
              ? makeUniqueArray([...opts.engineUrls])
              : [`http://127.0.0.1:${EL_ENGINE_BASE_PORT + opts.nodeIndex + 1}`],
        },
        runner
      );
    }
    default:
      throw new Error(`Beacon Client "${client}" not supported`);
  }
}
