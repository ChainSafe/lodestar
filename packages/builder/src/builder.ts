import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {Clock, ClockOptions, IClock} from "@lodestar/state-transition";
import {BuilderIndex, ExecutionAddress} from "@lodestar/types";
import {Logger, isErrorAborted, toHex, toRootHex} from "@lodestar/utils";
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
  store: PayloadStore;
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
  private readonly store: PayloadStore;

  constructor({
    opts,
    builderSigner,
    blockObserver,
    builderStatusTracker,
    proposerPreferencesTracker,
    clock,
    index,
    store,
  }: BuilderModules) {
    this.builderSigner = builderSigner;
    this.blockObserver = blockObserver;
    this.builderStatusTracker = builderStatusTracker;
    this.proposerPreferencesTracker = proposerPreferencesTracker;
    this.clock = clock;
    this.controller = opts.abortController;
    this.logger = opts.logger;
    this.index = index;
    this.store = store;

    this.executionFeeRecipient = opts.executionFeeRecipient;

    this.clock.runEverySlot(async (slot) => this.onSlot(slot));
    this.clock.runEveryEpoch((epoch) => this.builderStatusTracker.poll(epoch));
    this.clock.start(this.controller.signal);
    this.subscribeToEvents(opts.api);

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
    const proposerPreferencesTracker = new ProposerPreferencesTracker();

    const store = new PayloadStore();

    return new Builder({
      opts,
      builderSigner,
      blockObserver,
      builderStatusTracker,
      proposerPreferencesTracker,
      clock,
      index,
      store,
    });
  }

  private async onSlot(slot: number): Promise<void> {
    this.store.prune(slot);
    this.proposerPreferencesTracker.prune(slot);
  }

  private subscribeToEvents(api: ApiClient): void {
    const signal = this.controller.signal;
    if (signal.aborted) return;

    const topics = [routes.events.EventType.block, routes.events.EventType.proposerPreferences];
    this.logger.verbose("Subscribing to builder events", {topics: topics.join(",")});
    api.events
      .eventstream({
        topics,
        signal,
        onEvent: (event) => {
          void this.onEvent(event);
        },
        onError: (error) => {
          if (!signal.aborted) this.logger.warn("Failed to receive builder event", {topics: topics.join(",")}, error);
        },
        onClose: () => {
          if (signal.aborted) {
            this.logger.verbose("Closed builder event stream", {topics: topics.join(",")});
          } else {
            this.logger.error("Builder event stream closed unexpectedly", {topics: topics.join(",")});
          }
        },
      })
      .catch((error: unknown) => {
        if (!signal.aborted && !isErrorAborted(error)) {
          this.logger.error(
            "Failed to subscribe to builder events",
            {topics: topics.join(",")},
            error instanceof Error ? error : Error(String(error))
          );
        }
      });
  }

  private async onEvent(event: routes.events.BeaconEvent): Promise<void> {
    const signal = this.controller.signal;
    if (signal.aborted) return;

    try {
      switch (event.type) {
        case routes.events.EventType.block:
          await this.blockObserver.processBlockEvent(event.message, signal);
          break;
        case routes.events.EventType.proposerPreferences:
          this.proposerPreferencesTracker.onProposerPreferences(event.message.data);
          break;
      }
    } catch (error) {
      if (!signal.aborted && !isErrorAborted(error)) {
        this.logger.warn(
          "Failed to process builder event",
          {eventType: event.type},
          error instanceof Error ? error : Error(String(error))
        );
      }
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
  }
}
