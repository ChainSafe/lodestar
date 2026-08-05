import {ApiClient} from "@lodestar/api";
import {ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {Clock, ClockOptions, IClock} from "@lodestar/state-transition";
import {BuilderIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {waitForGenesis} from "./genesis.js";
import {resolveBuilderIdentity} from "./identity.js";
import {logNodeVersion, waitForNodeReady} from "./readiness.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";

export type BuilderModules = {
  opts: BuilderOptions;
  builderSigner: BuilderSigner;
  clock: IClock;
  index: BuilderIndex;
};

export type BuilderOptions = {
  logger: Logger;
  config: ChainForkConfig;
  keypair: Keypair;
  abortController: AbortController;
  api: ApiClient;
  clock?: ClockOptions;
};

/**
 * Main class for the Builder client.
 */
export class Builder {
  readonly builderSigner: BuilderSigner;
  private readonly controller: AbortController;
  private readonly clock: IClock;
  private readonly index: BuilderIndex;
  private readonly logger: Logger;

  constructor({opts, builderSigner, clock, index}: BuilderModules) {
    this.builderSigner = builderSigner;
    this.clock = clock;
    this.controller = opts.abortController;
    this.logger = opts.logger;
    this.index = index;

    this.clock.start(this.controller.signal);

    this.logger.info("Builder client initialized", {index: this.index});
  }

  static async init(opts: BuilderOptions): Promise<Builder> {
    const {api, logger} = opts;
    const genesis = await waitForGenesis(api, logger, opts.abortController.signal);
    logger.info("Genesis fetched from the beacon node");

    const specRes = await api.config.getSpec();
    assertEqualParams(opts.config, specRes.value());
    logger.info("Verified connected beacon node and builder have the same config");

    const config = createBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    const builderSigner = new BuilderSigner(config, opts.keypair);

    await waitForNodeReady(api, logger, opts.abortController.signal);
    await logNodeVersion(api, logger);

    const index = await resolveBuilderIdentity(api, logger, builderSigner.getPubkeyHex());

    const clock = new Clock(config, logger, {genesisTime: Number(genesis.genesisTime), ...opts.clock});

    return new Builder({opts, builderSigner, clock, index});
  }

  async close(): Promise<void> {
    this.controller.abort();
  }
}
