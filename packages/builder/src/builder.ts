import {SecretKey} from "@chainsafe/blst";
import {ApiClient} from "@lodestar/api";
import {BeaconConfig, ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {Genesis} from "@lodestar/types/phase0";
import {Logger} from "@lodestar/utils";
import {Metrics} from "./metrics.js";
import {BuilderSigner} from "./services/builderSigner.js";

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
  secretKey: SecretKey;
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

  constructor({opts, builderSigner, config, logger, metrics}: BuilderModules) {
    this.builderSigner = builderSigner;
    this.config = config;
    this.logger = logger;
    this.api = opts.api;
  }

  static init(opts: BuilderOptions, genesis: Genesis, metrics: Metrics | null = null): Builder {
    const config = createBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    const builderSigner = new BuilderSigner(config, opts.secretKey);

    return new Builder({opts, builderSigner, config, logger: opts.logger, metrics});
  }
}
