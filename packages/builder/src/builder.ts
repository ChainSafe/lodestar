import {ApiClient} from "@lodestar/api";
import {ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {Clock, ClockOptions, IClock} from "@lodestar/state-transition";
import {BuilderIndex, ExecutionAddress} from "@lodestar/types";
import {Logger, toHex, toRootHex} from "@lodestar/utils";
import {waitForGenesis} from "./genesis.js";
import {resolveBuilderIdentity} from "./identity.js";
import {Metrics} from "./metrics.js";
import {logNodeVersion, waitForNodeReady} from "./readiness.js";
import {BlockObserver} from "./services/blockObserver.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";
import {BuilderStatusTracker} from "./services/builderStatusTracker.js";
import {PayloadStore} from "./services/payloadStore.js";
import {ProposerPreferencesTracker} from "./services/proposerPreferencesTracker.js";

export type BuilderModules = {
  opts: BuilderOptions;
  builderSigner: BuilderSigner;
  blockObserver: BlockObserver;
  builderStatusTracker: BuilderStatusTracker;
  proposerPreferencesTracker: ProposerPreferencesTracker;
  clock: IClock;
  index: BuilderIndex;
  payloadStore: PayloadStore;
};

export type BuilderOptions = {
  logger: Logger;
  config: ChainForkConfig;
  keypair: Keypair;
  abortController: AbortController;
  api: ApiClient;
  clock?: ClockOptions;
  executionFeeRecipient: ExecutionAddress;
  metrics: Metrics | null;
};

/**
 * Main class for the Builder client.
 */
export class Builder {
  readonly builderSigner: BuilderSigner;
  readonly proposerPreferencesTracker: ProposerPreferencesTracker;
  private readonly blockObserver: BlockObserver;
  private readonly builderStatusTracker: BuilderStatusTracker;
  private readonly controller: AbortController;
  private readonly clock: IClock;
  private readonly index: BuilderIndex;
  private readonly logger: Logger;
  private readonly executionFeeRecipient: ExecutionAddress;
  private readonly payloadStore: PayloadStore;

  constructor({
    opts,
    builderSigner,
    blockObserver,
    builderStatusTracker,
    proposerPreferencesTracker,
    clock,
    index,
    payloadStore,
  }: BuilderModules) {
    this.builderSigner = builderSigner;
    this.blockObserver = blockObserver;
    this.builderStatusTracker = builderStatusTracker;
    this.proposerPreferencesTracker = proposerPreferencesTracker;
    this.clock = clock;
    this.controller = opts.abortController;
    this.logger = opts.logger;
    this.index = index;
    this.payloadStore = payloadStore;

    this.executionFeeRecipient = opts.executionFeeRecipient;

    this.clock.runEverySlot(async (slot) => this.onSlot(slot));
    this.clock.runEveryEpoch((epoch) => this.builderStatusTracker.poll(epoch));
    this.clock.start(this.controller.signal);
    this.blockObserver.start(this.controller.signal);
    this.proposerPreferencesTracker.start(this.controller.signal);

    this.logger.info("Builder client initialized", {
      index: this.index,
      executionFeeRecipient: toHex(this.executionFeeRecipient),
    });
  }

  static async init(opts: BuilderOptions): Promise<Builder> {
    const {api, logger} = opts;
    const genesis = await waitForGenesis(api, logger, opts.abortController.signal);
    logger.info("Genesis fetched from the beacon node", {
      genesisValidatorsRoot: toRootHex(genesis.genesisValidatorsRoot),
    });

    const specRes = await api.config.getSpec();
    assertEqualParams(opts.config, specRes.value());
    logger.info("Verified connected beacon node and builder have the same config");

    const config = createBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    const builderSigner = new BuilderSigner(config, opts.keypair);

    await waitForNodeReady(api, logger, opts.abortController.signal);
    await logNodeVersion(api, logger);

    const clock = new Clock(config, logger, {genesisTime: Number(genesis.genesisTime), ...opts.clock});

    const index = await resolveBuilderIdentity(
      api,
      logger,
      builderSigner.getPubkeyHex(),
      opts.abortController.signal,
      clock,
      config
    );

    const builderStatusTracker = new BuilderStatusTracker(api, logger, index, opts.metrics);
    const blockObserver = new BlockObserver(config, logger, api);
    const proposerPreferencesTracker = new ProposerPreferencesTracker(api, logger);

    const payloadStore = new PayloadStore();

    return new Builder({
      opts,
      builderSigner,
      blockObserver,
      builderStatusTracker,
      proposerPreferencesTracker,
      clock,
      index,
      payloadStore,
    });
  }

  private async onSlot(slot: number): Promise<void> {
    this.payloadStore.prune(slot);
    this.proposerPreferencesTracker.prune(slot);
  }

  async close(): Promise<void> {
    this.controller.abort();
  }
}
