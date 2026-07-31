import {ApiClient, routes} from "@lodestar/api";
import {BeaconConfig, ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {BuilderIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {waitForGenesis} from "./genesis.js";
import {Metrics} from "./metrics.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";

export type BuilderModules = {
  opts: BuilderOptions;
  config: BeaconConfig;
  builderSigner: BuilderSigner;
  index: BuilderIndex;
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
  private readonly index: BuilderIndex;
  private readonly config: BeaconConfig;
  private readonly api: ApiClient;
  private readonly logger: Logger;
  private readonly controller: AbortController;

  constructor({opts, builderSigner, config, logger, index, metrics}: BuilderModules) {
    this.builderSigner = builderSigner;
    this.index = index;
    this.config = config;
    this.logger = logger;
    this.api = opts.api;
    this.controller = opts.abortController;
  }

  static async init(opts: BuilderOptions, metrics: Metrics | null = null): Promise<Builder> {
    const genesis = await waitForGenesis(opts.api, opts.logger, opts.abortController.signal);
    opts.logger.info("Genesis fetched from the beacon node");

    {
      const res = await opts.api.config.getSpec();
      assertEqualParams(opts.config, res.value());
      opts.logger.info("Verified connected beacon node and builder have the same config");
    }

    const config = createBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    const builderSigner = new BuilderSigner(config, opts.keypair);

    const res = await opts.api.beacon.getStateBuilders({stateId: "head", builderIds: [builderSigner.getPubkeyHex()]});

    if (!res.ok) {
      throw Error("Getting state builders from BN failed.");
    }

    const builders = res.value();

    if (builders.length === 0) {
      throw Error(`Builder not registered: ${builderSigner.getPubkeyHex()}`);
    }

    const builderStatus: routes.beacon.BuilderResponse = builders[0];

    if (builderStatus.status !== "active") {
      throw Error("Builder not active");
    }

    if (builderStatus.builder.version !== PAYLOAD_BUILDER_VERSION) {
      throw Error("Version not matching");
    }

    return new Builder({opts, builderSigner, config, logger: opts.logger, index: builderStatus.index, metrics});
  }

  async close(): Promise<void> {
    this.controller.abort();
  }
}
