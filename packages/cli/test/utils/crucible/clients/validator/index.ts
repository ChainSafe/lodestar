import {writeFile} from "node:fs/promises";
import {BN_REST_BASE_PORT, SHARED_VALIDATOR_PASSWORD} from "../../constants.js";
import {
  BeaconClient,
  GeneratorOptions,
  ValidatorClient,
  ValidatorGeneratorOptions,
  ValidatorNode,
  ValidatorNodeDefinitionOptions,
} from "../../interfaces.js";
import {makeUniqueArray} from "../../utils/index.js";
import {createKeystores} from "../../utils/keys.js";
import {ensureDirectories, getNodePaths} from "../../utils/paths.js";
import {generateLighthouseValidatorNode} from "./lighthouse.js";
import {generateLodestarValidatorNode} from "./lodestar.js";

export async function createValidatorNode<V extends ValidatorClient>(
  client: V,
  options: ValidatorNodeDefinitionOptions<V> & GeneratorOptions
): Promise<ValidatorNode> {
  const {runner} = options;
  const clId = `${options.id}-${client}`;

  const opts: ValidatorGeneratorOptions = {
    ...options,
    paths: getNodePaths({id: options.id, logsDir: options.logsDir, client, root: options.rootDir}),
    beaconUrls: options.beaconUrls ?? [],
    id: clId,
    keys: options.keys ?? {type: "no-keys"},
    clientOptions: options.clientOptions ?? {},
    address: "127.0.0.1",
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
  await createKeystores(opts.paths, opts.keys);
  await writeFile(opts.paths.keystoresSecretFilePath, SHARED_VALIDATOR_PASSWORD);

  switch (client) {
    case ValidatorClient.Lodestar: {
      return generateLodestarValidatorNode(
        {
          ...opts,
          address: "127.0.0.1",
          beaconUrls:
            opts.beaconUrls.length > 0
              ? makeUniqueArray([`http://127.0.0.1:${BN_REST_BASE_PORT + opts.nodeIndex + 1}`, ...opts.beaconUrls])
              : [`http://127.0.0.1:${BN_REST_BASE_PORT + opts.nodeIndex + 1}`],
        },
        runner
      );
    }
    case ValidatorClient.Lighthouse: {
      return generateLighthouseValidatorNode(
        {
          ...opts,
          address: runner.getNextIp(),
          beaconUrls:
            opts.beaconUrls.length > 0
              ? makeUniqueArray([...opts.beaconUrls])
              : [`http://127.0.0.1:${BN_REST_BASE_PORT + opts.nodeIndex + 1}`],
        },
        runner
      );
    }
    default:
      throw new Error(`Validator Client "${client}" not supported`);
  }
}

export function getValidatorForBeaconNode(beacon: BeaconClient): ValidatorClient {
  switch (beacon) {
    case BeaconClient.Lodestar:
      return ValidatorClient.Lodestar;
    case BeaconClient.Lighthouse:
      return ValidatorClient.Lighthouse;
    default:
      throw new Error(`Beacon Client "${beacon}" not supported`);
  }
}
