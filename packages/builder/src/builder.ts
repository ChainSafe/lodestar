import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {Clock, ClockOptions, IClock} from "@lodestar/state-transition";
import {BuilderIndex, ExecutionAddress} from "@lodestar/types";
import {LodestarError, Logger, isErrorAborted, toHex, toRootHex} from "@lodestar/utils";
import {waitForGenesis} from "./genesis.js";
import {resolveBuilderIdentity} from "./identity.js";
import {Metrics} from "./metrics.js";
import {logNodeVersion, waitForNodeReady} from "./readiness.js";
import {BidLedger} from "./services/bidLedger.js";
import type {BidPolicy} from "./services/bidPolicy.js";
import {BidPublisher} from "./services/bidPublisher.js";
import {BidSelector} from "./services/bidSelector.js";
import {BlockObserver} from "./services/blockObserver.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";
import {BuilderStatusTracker} from "./services/builderStatusTracker.js";
import {EnvelopePublisher} from "./services/envelopePublisher.js";
import {
  PayloadAttributesConsumer,
  type PayloadAttributesConsumerOptions,
} from "./services/payloadAttributesConsumer.js";
import {PayloadOrchestrator, type PayloadOrchestratorOptions} from "./services/payloadOrchestrator.js";
import type {PayloadSource} from "./services/payloadSource.js";
import {PayloadStore} from "./services/payloadStore.js";
import {ProposerPreferencesTracker} from "./services/proposerPreferencesTracker.js";
import {Revealer, type RevealerOptions} from "./services/revealer.js";
import {SlotBidder} from "./services/slotBidder.js";

export type BuilderModules = {
  opts: BuilderOptions;
  builderSigner: BuilderSigner;
  blockObserver: BlockObserver;
  builderStatusTracker: BuilderStatusTracker;
  proposerPreferencesTracker: ProposerPreferencesTracker;
  clock: IClock;
  index: BuilderIndex;
  payloadStore: PayloadStore;
  payloadAttributesConsumer?: PayloadAttributesConsumer;
  bidLedger?: BidLedger;
};

/** Opt-in runtime using the source BN's Gloas payload-attributes events. */
export type BuilderBidOptions = {
  source: PayloadSource;
  policy: BidPolicy;
  orchestration: PayloadOrchestratorOptions;
  inputs: Omit<PayloadAttributesConsumerOptions, "executionFeeRecipient">;
  minOperatingBalanceGwei: number;
  reveal: RevealerOptions;
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
  bidRuntime?: BuilderBidOptions;
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
  private readonly payloadAttributesConsumer: PayloadAttributesConsumer | undefined;
  private readonly bidLedger: BidLedger | undefined;
  private readonly metrics: Metrics | null;

  constructor({
    opts,
    builderSigner,
    blockObserver,
    builderStatusTracker,
    proposerPreferencesTracker,
    clock,
    index,
    payloadStore,
    payloadAttributesConsumer,
    bidLedger,
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
    this.payloadAttributesConsumer = payloadAttributesConsumer;
    this.bidLedger = bidLedger;
    this.metrics = opts.metrics;

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
    if (opts.bidRuntime) {
      const {reveal} = opts.bidRuntime;
      if (!reveal) throw new LodestarError({code: "BUILDER_REVEAL_REQUIRED"});
      if (!Number.isSafeInteger(reveal.cutoffBps) || reveal.cutoffBps <= 0 || reveal.cutoffBps >= 10_000) {
        throw new LodestarError({code: "BUILDER_REVEAL_INVALID_CUTOFF"});
      }
    }
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

    const payloadStore = new PayloadStore();
    let bidLedger: BidLedger | undefined;
    let payloadAttributesConsumer: PayloadAttributesConsumer | undefined;
    if (opts.bidRuntime) {
      const {source, policy, orchestration, inputs, minOperatingBalanceGwei} = opts.bidRuntime;
      bidLedger = new BidLedger();
      const publisher = new BidPublisher({
        api,
        config,
        signer: builderSigner,
        ledger: bidLedger,
        builderIndex: index,
        hasPayload: (identity) => {
          const stored = payloadStore.get(identity.blockHash);
          return (
            stored !== null &&
            stored.slot === identity.slot &&
            toRootHex(stored.parentBlockRoot) === identity.parentBlockRoot &&
            toRootHex(stored.payload.executionPayload.parentHash) === identity.parentBlockHash &&
            toRootHex(stored.payload.executionPayload.blockHash) === identity.blockHash
          );
        },
      });
      const bidder = new SlotBidder(
        {
          buildPayload: (job, signal) => new PayloadOrchestrator(source, orchestration, signal).run(job),
          store: payloadStore,
          policy,
          ledger: bidLedger,
          publisher,
          builderIndex: index,
          builderStatusTracker,
        },
        {minOperatingBalanceGwei}
      );
      payloadAttributesConsumer = new PayloadAttributesConsumer(
        {config, clock, preferences: proposerPreferencesTracker, bidder},
        {...inputs, executionFeeRecipient: opts.executionFeeRecipient}
      );
      const {reveal} = opts.bidRuntime;
      const ledger = bidLedger;
      const selector = new BidSelector({
        config,
        ledger,
        builderIndex: index,
      });
      const envelopePublisher = new EnvelopePublisher({
        api,
        signer: builderSigner,
        ledger,
        builderIndex: index,
      });
      const revealer = new Revealer(
        {
          config,
          clock,
          logger,
          metrics: opts.metrics,
          builderIndex: index,
          ledger,
          selector,
          publisher: envelopePublisher,
          store: payloadStore,
        },
        reveal
      );
      blockObserver.runOnBlock((observed) => revealer.onBlock(observed, opts.abortController.signal));
    }
    opts.abortController.signal.throwIfAborted();

    return new Builder({
      opts,
      builderSigner,
      blockObserver,
      builderStatusTracker,
      proposerPreferencesTracker,
      clock,
      index,
      payloadStore,
      bidLedger,
      payloadAttributesConsumer,
    });
  }

  private async onSlot(slot: number): Promise<void> {
    this.payloadAttributesConsumer?.onSlot(slot);
    this.bidLedger?.prune(slot);
    this.payloadStore.prune(slot);
    this.proposerPreferencesTracker.prune(slot);
  }

  private subscribeToEvents(api: ApiClient): void {
    const signal = this.controller.signal;
    if (signal.aborted) return;

    const topics = [routes.events.EventType.block, routes.events.EventType.proposerPreferences];
    if (this.payloadAttributesConsumer) {
      topics.push(routes.events.EventType.headV2, routes.events.EventType.payloadAttributes);
    }
    this.logger.verbose("Subscribing to builder events", {topics: topics.join(",")});
    api.events
      .eventstream({
        topics,
        signal,
        onEvent: (event) => {
          void this.onEvent(event);
        },
        onOpen: () => {
          void this.fetchProposerPreferences(api);
        },
        onError: (error) => {
          if (!signal.aborted) this.logger.error("Failed to receive builder event", {topics: topics.join(",")}, error);
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

  /**
   * Proposer preferences are only broadcast once per proposal slot, fetch the ones the beacon node
   * already knows to cover those missed while not connected, e.g. after a restart
   */
  private async fetchProposerPreferences(api: ApiClient): Promise<void> {
    const signal = this.controller.signal;

    try {
      const preferences = (await api.beacon.getProposerPreferences({}, {signal})).value();
      for (const signedProposerPreferences of preferences) {
        // Does not replace preferences already received from the event stream
        this.proposerPreferencesTracker.onProposerPreferences(signedProposerPreferences);
      }
      this.logger.verbose("Fetched proposer preferences", {count: preferences.length});
    } catch (error) {
      if (!signal.aborted && !isErrorAborted(error)) {
        this.logger.warn(
          "Failed to fetch proposer preferences",
          {},
          error instanceof Error ? error : Error(String(error))
        );
      }
    }
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
        case routes.events.EventType.headV2:
        case routes.events.EventType.payloadAttributes:
          break;
      }
      if (event.type !== routes.events.EventType.block) {
        const result = await this.payloadAttributesConsumer?.onEvent(event, signal);
        if (result?.status === "published") {
          this.metrics?.bids.inc({result: "published"});
          this.logger.info("Published execution payload bid", result);
        } else if (result?.status === "not_published") {
          this.metrics?.bids.inc({result: result.reason});
          this.logger.debug("Execution payload bid not published", result);
        } else if (result?.status === "ignored") {
          this.logger.debug("Payload input deferred or ignored", {eventType: event.type, reason: result.reason});
        }
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
    this.payloadAttributesConsumer?.close();
  }
}
