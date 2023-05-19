import {writeFile} from "node:fs/promises";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {SHARED_JWT_SECRET, SHARED_VALIDATOR_PASSWORD, EL_ENGINE_BASE_PORT} from "../constants.js";
import {AtLeast, CLClient, CLClientGeneratorOptions, CLNode, IRunner} from "../interfaces.js";
import {makeUniqueArray} from "../utils/index.js";
import {createKeystores} from "../utils/keys.js";
import {createCLNodePaths} from "../utils/paths.js";
import {generateLighthouseBeaconNode} from "./lighthouse.js";
import {generateLodestarBeaconNode} from "./lodestar.js";

export async function createCLNode<C extends CLClient>(
  client: C,
  options: AtLeast<CLClientGeneratorOptions<C>, "id" | "paths" | "config" | "paths" | "nodeIndex" | "genesisTime"> & {
    genesisState?: BeaconStateAllForks;
    runner: IRunner;
  }
): Promise<CLNode> {
  const {runner, config, genesisState} = options;
  const clId = `${options.id}-cl-${client}`;

  const opts: CLClientGeneratorOptions = {
    ...options,
    id: clId,
    keys: options.keys ?? {type: "no-keys"},
    genesisTime: options.genesisTime + config.GENESIS_DELAY,
    engineMock: options.engineMock ?? false,
    clientOptions: options.clientOptions ?? {},
    address: "127.0.0.1",
    engineUrls: options.engineUrls ?? [],
  };

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
