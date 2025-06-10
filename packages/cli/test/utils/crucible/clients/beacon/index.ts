import {EL_ENGINE_BASE_PORT} from "../../constants.js";
import {
  BeaconClient,
  BeaconGeneratorOptions,
  BeaconNode,
  BeaconNodeDefinitionOptions,
  GeneratorOptions,
} from "../../interfaces.js";
import {makeUniqueArray} from "../../utils/index.js";
import {ensureDirectories, getNodePaths} from "../../utils/paths.js";
import {generateLighthouseBeaconNode} from "./lighthouse.js";
import {generateLodestarBeaconNode} from "./lodestar.js";

export async function createBeaconNode<B extends BeaconClient>(
  client: B,
  options: BeaconNodeDefinitionOptions<B> & GeneratorOptions
): Promise<BeaconNode> {
  const {runner} = options;
  const clId = `${options.id}-${client}`;

  const opts: BeaconGeneratorOptions = {
    ...options,
    paths: getNodePaths({id: options.id, logsDir: options.logsDir, client, root: options.rootDir}),
    id: clId,
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
