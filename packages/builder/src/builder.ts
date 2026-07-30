import {ApiClient} from "@lodestar/api";
import {BeaconConfig, ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {waitForGenesis} from "./genesis.js";
import {Metrics} from "./metrics.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";

export type BuilderModules = {
  opts: BuilderOptions;
  config: BeaconConfig;
  builderSigner: BuilderSigner;
  logger: Logger;
  metrics: Metrics | null;
};

export type BuilderOptions = {
  logger: Logger;
  config: ChainForkConfig;
  keypair: Keypair;
  abortController: AbortController;
  api: ApiClient;
};

/**
 * Main class for the Builder client.
 */
export class Builder {
  readonly builderSigner: BuilderSigner;
  private readonly config: BeaconConfig;
  private readonly api: ApiClient;
  private readonly logger: Logger;
  private readonly controller: AbortController;

  constructor({opts, builderSigner, config, logger, metrics}: BuilderModules) {
    this.builderSigner = builderSigner;
    this.config = config;
    this.logger = logger;
    this.api = opts.api;
    this.controller = opts.abortController;
  }

  static async init(opts: BuilderOptions, metrics: Metrics | null = null): Promise<Builder> {
    const genesis = await waitForGenesis(opts.api, opts.logger, opts.abortController.signal);
    opts.logger.info("Genesis fetched from the beacon node");

    // TODO: Verify chain config matches the source BN. `assertEqualParams` in @lodestar/validator
    // does this but is package-private. Best fix is moving it somewhere shared.

    const config = createBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    const builderSigner = new BuilderSigner(config, opts.keypair);

    return new Builder({opts, builderSigner, config, logger: opts.logger, metrics});
  }

  async close(): Promise<void> {
    this.controller.abort();
  }
}
