import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {Clock, ClockOptions, IClock} from "@lodestar/state-transition";
import {BuilderIndex, ExecutionAddress} from "@lodestar/types";
import {Logger, toHex, toRootHex} from "@lodestar/utils";
import {waitForGenesis} from "./genesis.js";
import {resolveBuilderIdentity} from "./identity.js";
import {Metrics} from "./metrics.js";
import {logNodeVersion, waitForNodeReady} from "./readiness.js";
import {BidPolicy, ProportionalBidPolicy, ProportionalBidPolicyOpts} from "./services/bidPolicy.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";
import {BuilderStatusTracker} from "./services/builderStatusTracker.js";
import {ChainEvents} from "./services/chainEvents.js";
import {Ledger} from "./services/ledger.js";
import {PayloadSource} from "./services/payloadSource.js";
import {PayloadStore} from "./services/payloadStore.js";
import {ProposerPreferencesTracker} from "./services/proposerPreferencesTracker.js";
import {Revealer} from "./services/revealer.js";
import {SlotBidder, SlotBidderOpts} from "./services/slotBidder.js";

export type BuilderModules = {
  opts: BuilderOptions;
  builderSigner: BuilderSigner;
  builderStatusTracker: BuilderStatusTracker;
  clock: IClock;
  index: BuilderIndex;
  chainEvents: ChainEvents;
  preferences: ProposerPreferencesTracker;
  store: PayloadStore;
  ledger: Ledger;
  slotBidder: SlotBidder;
  revealer: Revealer;
};

export type BuilderOptions = {
  logger: Logger;
  config: ChainForkConfig;
  keypair: Keypair;
  abortController: AbortController;
  api: ApiClient;
  clock?: ClockOptions;
  /** Coinbase of built payloads, receives tips and MEV */
  executionFeeRecipient: ExecutionAddress;
  metrics: Metrics | null;
  /** Execution clients that build payloads, the most valuable payload across sources is bid on */
  sources: PayloadSource[];
  bidding: SlotBidderOpts & ProportionalBidPolicyOpts;
  /** Custom bid policy, defaults to ProportionalBidPolicy from the bidding options */
  bidPolicy?: BidPolicy;
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
  private readonly builderStatusTracker: BuilderStatusTracker;
  private readonly controller: AbortController;
  private readonly clock: IClock;
  private readonly index: BuilderIndex;
  private readonly logger: Logger;
  private readonly executionFeeRecipient: ExecutionAddress;
  private readonly chainEvents: ChainEvents;
  private readonly preferences: ProposerPreferencesTracker;
  private readonly store: PayloadStore;
  private readonly ledger: Ledger;
  private readonly slotBidder: SlotBidder;
  private readonly revealer: Revealer;

  constructor({
    opts,
    builderSigner,
    builderStatusTracker,
    clock,
    index,
    chainEvents,
    preferences,
    store,
    ledger,
    slotBidder,
    revealer,
  }: BuilderModules) {
    this.builderSigner = builderSigner;
    this.builderStatusTracker = builderStatusTracker;
    this.clock = clock;
    this.controller = opts.abortController;
    this.logger = opts.logger;
    this.index = index;
    this.executionFeeRecipient = opts.executionFeeRecipient;
    this.chainEvents = chainEvents;
    this.preferences = preferences;
    this.store = store;
    this.ledger = ledger;
    this.slotBidder = slotBidder;
    this.revealer = revealer;

    this.chainEvents.on(routes.events.EventType.payloadAttributes, (event) =>
      this.slotBidder.onPayloadAttributes(event)
    );
    this.chainEvents.on(routes.events.EventType.proposerPreferences, ({data}) =>
      this.preferences.onProposerPreferences(data)
    );
    this.chainEvents.on(routes.events.EventType.block, (event) => this.revealer.onBlock(event));

    this.clock.runEverySlot(async (slot) => this.onSlot(slot));
    this.clock.runEveryEpoch((epoch) => this.builderStatusTracker.poll(epoch));
    this.clock.start(this.controller.signal);
    this.chainEvents.start(this.controller.signal);

    this.logger.info("Builder client initialized", {
      index: this.index,
      executionFeeRecipient: toHex(this.executionFeeRecipient),
      sources: opts.sources.map((source) => source.id).join(","),
      shareBps: opts.bidding.shareBps,
      deadlineBps: opts.bidding.deadlineBps,
    });
  }

  static async init(opts: BuilderOptions): Promise<Builder> {
    const {api, logger} = opts;
    if (opts.sources.length === 0) {
      throw Error("At least one payload source is required");
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
    await builderStatusTracker.poll(clock.getCurrentEpoch());

    const chainEvents = new ChainEvents(api, logger);
    const preferences = new ProposerPreferencesTracker();
    const store = new PayloadStore();
    const ledger = new Ledger();
    const policy = opts.bidPolicy ?? new ProportionalBidPolicy(opts.bidding);

    const slotBidder = new SlotBidder(
      {
        config,
        logger,
        clock,
        api,
        signer: builderSigner,
        sources: opts.sources,
        store,
        policy,
        ledger,
        preferences,
        getBuilderStatus: () => builderStatusTracker.getStatus(),
        builderIndex: index,
        executionFeeRecipient: opts.executionFeeRecipient,
        metrics: opts.metrics,
      },
      opts.bidding
    );

    const revealer = new Revealer(
      {
        config,
        logger,
        clock,
        api,
        signer: builderSigner,
        store,
        ledger,
        builderIndex: index,
        metrics: opts.metrics,
      },
      {cutoffBps: opts.reveal.cutoffBps ?? config.PAYLOAD_ATTESTATION_DUE_BPS}
    );

    return new Builder({
      opts,
      builderSigner,
      builderStatusTracker,
      clock,
      index,
      chainEvents,
      preferences,
      store,
      ledger,
      slotBidder,
      revealer,
    });
  }

  private async onSlot(slot: number): Promise<void> {
    this.slotBidder.onSlot(slot);
    this.store.prune(slot);
    this.ledger.prune(slot);
    this.preferences.prune(slot);
  }

  async close(): Promise<void> {
    this.slotBidder.close();
    this.controller.abort();
  }
}
