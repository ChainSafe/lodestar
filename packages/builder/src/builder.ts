import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {Clock, ClockOptions, IClock} from "@lodestar/state-transition";
import {BuilderIndex, ExecutionAddress} from "@lodestar/types";
import {LodestarError, Logger, isErrorAborted, toHex, toRootHex} from "@lodestar/utils";
import {waitForGenesis} from "./genesis.js";
import {resolveBuilderIdentity} from "./identity.js";
import {Metrics} from "./metrics.js";
import {logNodeVersion, waitForNodeReady} from "./readiness.js";
import {Bidder, BidderOptions} from "./services/bidder.js";
import {BidLedger} from "./services/bidLedger.js";
import {ProportionalBidPolicy, ProportionalBidPolicyOpts} from "./services/bidPolicy.js";
import {BidPublisher} from "./services/bidPublisher.js";
import {BidSelector} from "./services/bidSelector.js";
import {BlockObserver} from "./services/blockObserver.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";
import {BuilderStatusTracker} from "./services/builderStatusTracker.js";
import {EnvelopePublisher} from "./services/envelopePublisher.js";
import {PayloadOrchestrator} from "./services/payloadOrchestrator.js";
import {PayloadSource} from "./services/payloadSource.js";
import {PayloadStore} from "./services/payloadStore.js";
import {ProposerPreferencesTracker} from "./services/proposerPreferencesTracker.js";
import {Revealer} from "./services/revealer.js";

export type BuilderModules = {
  opts: BuilderOptions;
  builderSigner: BuilderSigner;
  blockObserver: BlockObserver;
  builderStatusTracker: BuilderStatusTracker;
  proposerPreferencesTracker: ProposerPreferencesTracker;
  clock: IClock;
  index: BuilderIndex;
  payloadStore: PayloadStore;
  ledger: BidLedger;
  bidder: Bidder;
  revealer: Revealer;
};

export type BuilderOptions = {
  logger: Logger;
  config: ChainForkConfig;
  keypair: Keypair;
  abortController: AbortController;
  api: ApiClient;
  clock?: ClockOptions;
  /** Fee recipient of built payloads, receives priority fees and MEV */
  executionFeeRecipient: ExecutionAddress;
  metrics: Metrics | null;
  /** Payload construction engine, an execution client is one implementation */
  payloadSource: PayloadSource;
  bidding: BidderOptions &
    ProportionalBidPolicyOpts & {
      /** Maximum time in milliseconds to wait for payload retrieval at the bid deadline */
      getPayloadTimeout: number;
    };
  reveal: {
    /** Defaults to PAYLOAD_ATTESTATION_DUE_BPS of the network */
    cutoffBps?: number;
  };
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
  private readonly ledger: BidLedger;
  private readonly bidder: Bidder;
  private readonly revealer: Revealer;
  private connectionGeneration = 0;

  constructor({
    opts,
    builderSigner,
    blockObserver,
    builderStatusTracker,
    proposerPreferencesTracker,
    clock,
    index,
    payloadStore,
    ledger,
    bidder,
    revealer,
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
    this.ledger = ledger;
    this.bidder = bidder;
    this.revealer = revealer;

    this.executionFeeRecipient = opts.executionFeeRecipient;

    this.blockObserver.runOnBlock((block) => this.revealer.onBlock(block));
    this.clock.runEverySlot(async (slot) => this.onSlot(slot));
    this.clock.runEveryEpoch((epoch) => this.builderStatusTracker.poll(epoch));
    this.clock.start(this.controller.signal);
    this.subscribeToEvents(opts.api);

    this.logger.info("Builder client initialized", {
      index: this.index,
      executionFeeRecipient: toHex(this.executionFeeRecipient),
      payloadSource: opts.payloadSource.id,
      shareBps: opts.bidding.shareBps,
      deadlineBps: opts.bidding.deadlineBps,
    });
  }

  static async init(opts: BuilderOptions): Promise<Builder> {
    opts.abortController.signal.throwIfAborted();
    for (const [option, value] of [
      ["bidding.deadlineBps", opts.bidding.deadlineBps],
      ["reveal.cutoffBps", opts.reveal.cutoffBps ?? opts.config.PAYLOAD_ATTESTATION_DUE_BPS],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0 || value >= 10_000)
        throw new LodestarError({code: "BUILDER_ERROR_INVALID_OPTIONS", option, value});
    }
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

    opts.abortController.signal.throwIfAborted();
    const builderStatusTracker = new BuilderStatusTracker(api, logger, index, opts.metrics);
    await builderStatusTracker.poll(clock.getCurrentEpoch());
    opts.abortController.signal.throwIfAborted();
    const proposerPreferencesTracker = new ProposerPreferencesTracker();

    const payloadStore = new PayloadStore();
    const ledger = new BidLedger();
    const blockObserver = new BlockObserver(config, logger, api, {
      builderIndex: index,
      hasBidForSlot: (slot) => ledger.getBidsForSlot(slot).length > 0,
    });
    const signal = opts.abortController.signal;

    const bidder = new Bidder(
      {
        config,
        logger,
        clock,
        api,
        createOrchestrator: (signal) =>
          new PayloadOrchestrator(opts.payloadSource, {getPayloadTimeout: opts.bidding.getPayloadTimeout}, signal),
        payloadStore,
        ledger,
        policy: new ProportionalBidPolicy(opts.bidding),
        bidPublisher: new BidPublisher({
          api,
          config,
          signer: builderSigner,
          ledger,
          builderIndex: index,
          hasPayload: ({blockHash}) => payloadStore.has(blockHash),
        }),
        proposerPreferencesTracker,
        getBuilderStatus: () => builderStatusTracker.getStatus(),
        builderIndex: index,
        executionFeeRecipient: opts.executionFeeRecipient,
        metrics: opts.metrics,
        signal,
      },
      opts.bidding
    );

    const revealer = new Revealer(
      {
        config,
        logger,
        clock,
        bidSelector: new BidSelector({config, ledger, builderIndex: index}),
        payloadStore,
        envelopePublisher: new EnvelopePublisher({api, signer: builderSigner, ledger, builderIndex: index}),
        builderIndex: index,
        metrics: opts.metrics,
        signal,
      },
      {cutoffBps: opts.reveal.cutoffBps ?? config.PAYLOAD_ATTESTATION_DUE_BPS}
    );

    return new Builder({
      opts,
      builderSigner,
      blockObserver,
      builderStatusTracker,
      proposerPreferencesTracker,
      clock,
      index,
      payloadStore,
      ledger,
      bidder,
      revealer,
    });
  }

  private async onSlot(slot: number): Promise<void> {
    this.payloadStore.prune(slot);
    this.proposerPreferencesTracker.prune(slot);
    this.ledger.prune(slot);
  }

  private subscribeToEvents(api: ApiClient): void {
    const signal = this.controller.signal;
    if (signal.aborted) return;

    const topics = [
      routes.events.EventType.block,
      routes.events.EventType.proposerPreferences,
      routes.events.EventType.payloadAttributes,
    ];
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
        onDisconnect: () => {
          this.connectionGeneration++;
          this.bidder.invalidateInputs();
        },
        onError: (error) => {
          if (!signal.aborted) this.logger.error("Failed to receive builder event", {topics: topics.join(",")}, error);
        },
        onClose: () => {
          this.connectionGeneration++;
          this.bidder.invalidateInputs();
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
    const generation = this.connectionGeneration;

    try {
      const preferences = (await api.beacon.getProposerPreferences({}, {signal})).value();
      if (signal.aborted || generation !== this.connectionGeneration) return;
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
      return;
    }
    try {
      await this.bidder.onPreferences();
    } catch (error) {
      if (!signal.aborted && !isErrorAborted(error))
        this.logger.error("Failed to resume bidding after preference recovery", {}, error as Error);
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
          await this.bidder.onPreferences();
          break;
        case routes.events.EventType.payloadAttributes:
          await this.bidder.onPayloadAttributes(event.message);
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
