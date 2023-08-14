import {writeFile} from "node:fs/promises";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {SHARED_JWT_SECRET, SHARED_VALIDATOR_PASSWORD, EL_ENGINE_BASE_PORT} from "../constants.js";
import {AtLeast, CLClient, CLClientGeneratorOptions, CLNode, IRunner} from "../interfaces.js";
import {makeUniqueArray} from "../utils/index.js";
import {createKeystores} from "../utils/keys.js";
import {createCLNodePaths} from "../utils/paths.js";
import {generateLighthouseBeaconNode} from "./lighthouse.js";
import {generateLodestarBeaconNode} from "./lodestar.js";

type GeneratorRequiredOptions<C extends CLClient> = AtLeast<
  CLClientGeneratorOptions<C>,
  "id" | "paths" | "config" | "nodeIndex" | "genesisTime"
> & {
  genesisState?: BeaconStateAllForks;
  runner: IRunner;
};

export async function createCLNode<B extends CLClient, V extends CLClient>({
  beacon,
  beaconOptions,
  validator,
  validatorOptions,
}: {
  beacon: B;
  beaconOptions: GeneratorRequiredOptions<B>;
  validator: V;
  validatorOptions: GeneratorRequiredOptions<V>;
}): Promise<CLNode> {
  const beaconNode = await createCLNodeComponent(beacon, beaconOptions, "beacon");
  const validatorNode = await createCLNodeComponent(validator, validatorOptions, "validator");

  return {
    ...beaconNode,
    beaconJob: beaconNode.beaconJob,
    validatorJob: validatorNode.validatorJob,
  };
}

async function createCLNodeComponent<C extends CLClient>(
  client: C,
  options: GeneratorRequiredOptions<C>,
  component: "beacon" | "validator"
): Promise<CLNode> {
  const {runner, config, genesisState} = options;
  const clId = `${options.id}-cl-${client}-${component}`;

  const opts: CLClientGeneratorOptions = {
    ...options,
    id: clId,
    keys: options.keys ?? {type: "no-keys"},
    genesisTime: options.genesisTime + config.GENESIS_DELAY,
    engineMock: options.engineMock ?? false,
    clientOptions: options.clientOptions ?? {},
    address: "127.0.0.1",
    engineUrls: options.engineUrls ?? [],
    beacon: component === "beacon",
    validator: component === "validator",
  };

  const metricServer = process.env.SIM_METRIC_SERVER_URL;
  if (metricServer) {
    const server = new URL(metricServer.startsWith("http") ? metricServer : `http://${metricServer}`);
    opts.metrics = {
      host: server.hostname,
      port: parseInt(server.port as string),
    };
  }

  await createCLNodePaths(opts.paths);
  await createKeystores(opts.paths, opts.keys);
  await writeFile(opts.paths.jwtsecretFilePath, SHARED_JWT_SECRET);
  await writeFile(opts.paths.keystoresSecretFilePath, SHARED_VALIDATOR_PASSWORD);

  // We have to wite the genesis state but can't do that without starting up
  // at least one EL node and getting ETH_HASH, so will do in startup
  //await writeFile(clPaths.genesisFilePath, this.genesisState);

  if (genesisState) {
    await writeFile(opts.paths.genesisFilePath, genesisState.serialize());
  }

  switch (client) {
    case CLClient.Lodestar: {
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
    case CLClient.Lighthouse: {
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
      throw new Error(`CL Client "${client}" not supported`);
  }
}
