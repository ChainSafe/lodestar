import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {Clock, ClockOptions, IClock} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {waitForGenesis} from "./genesis.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";

export type BuilderModules = {
  opts: BuilderOptions;
  builderSigner: BuilderSigner;
  clock: IClock;
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

  constructor({opts, builderSigner, clock}: BuilderModules) {
    this.builderSigner = builderSigner;
    this.clock = clock;
    this.controller = opts.abortController;

    this.clock.start(this.controller.signal);
  }

  static async init(opts: BuilderOptions): Promise<Builder> {
    const genesis = await waitForGenesis(opts.api, opts.logger, opts.abortController.signal);
    opts.logger.info("Genesis fetched from the beacon node");

    const specRes = await opts.api.config.getSpec();
    assertEqualParams(opts.config, specRes.value());
    opts.logger.info("Verified connected beacon node and builder have the same config");

    const config = createBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    const builderSigner = new BuilderSigner(config, opts.keypair);

    const builderRes = await opts.api.beacon.getStateBuilders({
      stateId: "head",
      builderIds: [builderSigner.getPubkeyHex()],
    });

    if (!builderRes.ok) {
      throw Error(`Getting state builders from BN failed: ${builderRes.status}`);
    }

    const builders = builderRes.value();

    if (builders.length === 0) {
      throw Error(`Builder not registered: ${builderSigner.getPubkeyHex()}`);
    }

    const builderStatus: routes.beacon.BuilderResponse = builders[0];

    if (builderStatus.status !== "active") {
      throw Error(`Builder not active: ${builderStatus.status}`);
    }

    if (builderStatus.builder.version !== PAYLOAD_BUILDER_VERSION) {
      throw Error(
        `Builder version mismatch: got ${builderStatus.builder.version}, expected ${PAYLOAD_BUILDER_VERSION}`
      );
    }

    const clock = new Clock(config, opts.logger, {genesisTime: Number(genesis.genesisTime), ...opts.clock});

    return new Builder({opts, builderSigner, clock});
  }

  async close(): Promise<void> {
    this.controller.abort();
  }
}
