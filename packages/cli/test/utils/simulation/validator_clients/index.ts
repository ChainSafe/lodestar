import {writeFile} from "node:fs/promises";
import {SHARED_JWT_SECRET, SHARED_VALIDATOR_PASSWORD, BN_REST_BASE_PORT} from "../constants.js";
import {AtLeast, BeaconClient, ValidatorClient, ValidatorGeneratorOptions, ValidatorNode} from "../interfaces.js";
import {makeUniqueArray} from "../utils/index.js";
import {createKeystores} from "../utils/keys.js";
import {ensureDirectories} from "../utils/paths.js";
import {generateLodestarValidatorNode} from "./lodestar.js";
import {generateLighthouseValidatorNode} from "./lighthouse.js";

export async function createValidatorNode<V extends ValidatorClient>(
  client: V,
  options: AtLeast<
    ValidatorGeneratorOptions<V>,
    "id" | "paths" | "forkConfig" | "nodeIndex" | "genesisTime" | "runner" | "beaconUrls"
  >
): Promise<ValidatorNode> {
  const {runner, forkConfig} = options;
  const clId = `${options.id}-${client}`;

  const opts: ValidatorGeneratorOptions = {
    ...options,
    id: clId,
    keys: options.keys ?? {type: "no-keys"},
    genesisTime: options.genesisTime + forkConfig.GENESIS_DELAY,
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
  await writeFile(opts.paths.jwtsecretFilePath, SHARED_JWT_SECRET);
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
