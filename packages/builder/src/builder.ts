import path from "node:path";
import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig, assertEqualParams, createBeaconConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Clock, ClockOptions, IClock} from "@lodestar/state-transition";
import {BuilderIndex, ExecutionAddress} from "@lodestar/types";
import {Logger, fromHex, isErrorAborted, toHex, toRootHex} from "@lodestar/utils";
import {BuilderBidStreamApi, getBuilderBidStreamApi} from "./api/bidStream.js";
import {BuilderApi, BuilderApiOptions, getBuilderApi} from "./api/impl.js";
import {defaultOptions} from "./defaults.js";
import {waitForGenesis} from "./genesis.js";
import {AssumedBuilderIdentity, resolveBuilderIdentity, resolveGossipBuilderIdentity} from "./identity.js";
import {Metrics} from "./metrics.js";
import {logNodeVersion, waitForNodeReady} from "./readiness.js";
import {AsyncCommitmentJournal} from "./services/asyncCommitmentJournal.js";
import {Bidder, BidderOptions} from "./services/bidder.js";
import {BidLedger} from "./services/bidLedger.js";
import {ProportionalBidPolicy, ProportionalBidPolicyOpts} from "./services/bidPolicy.js";
import {BidPublisher} from "./services/bidPublisher.js";
import {BidSelector} from "./services/bidSelector.js";
import {BidStore} from "./services/bidStore.js";
import {BlockObserver} from "./services/blockObserver.js";
import {BuilderSigner, Keypair} from "./services/builderSigner.js";
import {BuilderSigningGuard} from "./services/builderSigningGuard.js";
import {BuilderStatusTracker} from "./services/builderStatusTracker.js";
import {CommitmentJournal} from "./services/commitmentJournal.js";
import {EnvelopePublisher} from "./services/envelopePublisher.js";
import {
  GossipStage,
  MAX_ADDITIONAL_GOSSIP_IDENTITIES,
  assertGossipJournalsConfigured,
  gossipJournalDirectory,
  validateGossipStages,
} from "./services/gossipStages.js";
import {OrderExposure} from "./services/orderExposure.js";
import {isOrderOfferAllowed} from "./services/orderMetadata.js";
import {PayloadOrchestrator} from "./services/payloadOrchestrator.js";
import {PayloadSource} from "./services/payloadSource.js";
import {PayloadStore} from "./services/payloadStore.js";
import {ProposerDutiesTracker} from "./services/proposerDutiesTracker.js";
import {ProposerPreferencesCache} from "./services/proposerPreferencesCache.js";
import {ProposerPreferencesRecovery, ProposerPreferencesSource} from "./services/proposerPreferencesRecovery.js";
import {ProposerPreferencesTracker} from "./services/proposerPreferencesTracker.js";
import {Revealer, RevealerOptions} from "./services/revealer.js";

// Payments of won bids are reflected in the builder balance after this many slots
const PAYMENT_SETTLEMENT_SLOTS = 3 * SLOTS_PER_EPOCH;

export type BuilderModules = {
  opts: BuilderOptions;
  builderSigner: BuilderSigner;
  blockObserver: BlockObserver;
  builderStatusTracker: BuilderStatusTracker;
  proposerPreferencesTracker: ProposerPreferencesTracker;
  proposerPreferencesRecovery: ProposerPreferencesRecovery;
  clock: IClock;
  index: BuilderIndex;
  payloadStore: PayloadStore;
  bidStore: BidStore;
  ledger: BidLedger;
  bidder: Bidder;
  revealer: Revealer;
  builderApi: BuilderApi | null;
  builderBidStreamApi?: BuilderBidStreamApi | null;
  journal?: AsyncCommitmentJournal;
  signingGuard?: BuilderSigningGuard;
  preferencesCache?: ProposerPreferencesCache;
  gossipIdentities?: GossipIdentity[];
};

type GossipIdentity = {
  stage: GossipStage;
  builderStatusTracker: BuilderStatusTracker;
  revealer: Revealer;
  journal?: AsyncCommitmentJournal;
};

export type BuilderOptions = {
  logger: Logger;
  config: ChainForkConfig;
  keypair: Keypair;
  /** Additional registered identities, each used once per parent at its scheduled gossip time. */
  gossipIdentities?: {keypair: Keypair; deadlineBps: number}[];
  abortController: AbortController;
  api: ApiClient;
  clock?: ClockOptions;
  /** Fee recipient of built payloads, receives priority fees and MEV */
  executionFeeRecipient: ExecutionAddress;
  metrics: Metrics | null;
  /** Execution client that builds the payloads */
  payloadSource: PayloadSource;
  bidding: BidderOptions &
    ProportionalBidPolicyOpts & {
      /** Maximum time in milliseconds to wait for payload retrieval at the bid deadline */
      getPayloadTimeout: number;
    };
  reveal: Omit<RevealerOptions, "cutoffBps"> & {
    /** Defaults to PAYLOAD_ATTESTATION_DUE_BPS of the network */
    cutoffBps?: number;
  };
  /** The builder API is only served if set */
  builderApi?: BuilderApiOptions;
  /** Single-owner directory for durable Gloas bids, payloads and reveal conflicts. */
  commitmentDir?: string;
  proposerPreferences?: {
    /** Trusted beacon nodes on the same network whose pools are polled for preferences `api` missed */
    sources: ProposerPreferencesSource[];
    /** Deadline per poll in milliseconds, defaults to 1000 */
    timeoutMs?: number;
  };
  /** Identity to use before the Gloas fork, see {@link AssumedBuilderIdentity} */
  assumedIdentity?: AssumedBuilderIdentity;
};

/**
 * Main class for the Builder client.
 */
export class Builder {
  readonly orderExposure: OrderExposure;
  readonly builderSigner: BuilderSigner;
  readonly proposerPreferencesTracker: ProposerPreferencesTracker;
  readonly builderApi: BuilderApi | null;
  readonly builderBidStreamApi: BuilderBidStreamApi | null;
  private readonly proposerPreferencesRecovery: ProposerPreferencesRecovery;
  private readonly blockObserver: BlockObserver;
  private readonly builderStatusTracker: BuilderStatusTracker;
  private readonly controller: AbortController;
  private readonly clock: IClock;
  private readonly index: BuilderIndex;
  private readonly logger: Logger;
  private readonly executionFeeRecipient: ExecutionAddress;
  private readonly payloadStore: PayloadStore;
  private readonly bidStore: BidStore;
  private readonly ledger: BidLedger;
  private readonly bidder: Bidder;
  private readonly revealer: Revealer;
  private readonly journal?: AsyncCommitmentJournal;
  private readonly signingGuard?: BuilderSigningGuard;
  private readonly preferencesCache?: ProposerPreferencesCache;
  private readonly gossipIdentities: GossipIdentity[];

  constructor({
    opts,
    builderSigner,
    blockObserver,
    builderStatusTracker,
    proposerPreferencesTracker,
    proposerPreferencesRecovery,
    clock,
    index,
    payloadStore,
    bidStore,
    ledger,
    bidder,
    revealer,
    builderApi,
    builderBidStreamApi = null,
    journal,
    signingGuard,
    preferencesCache,
    gossipIdentities = [],
  }: BuilderModules) {
    this.orderExposure = new OrderExposure([journal, ...gossipIdentities.map((identity) => identity.journal)]);
    this.builderSigner = builderSigner;
    this.blockObserver = blockObserver;
    this.builderStatusTracker = builderStatusTracker;
    this.proposerPreferencesTracker = proposerPreferencesTracker;
    this.proposerPreferencesRecovery = proposerPreferencesRecovery;
    this.clock = clock;
    this.controller = opts.abortController;
    this.logger = opts.logger;
    this.index = index;
    this.payloadStore = payloadStore;
    this.bidStore = bidStore;
    this.ledger = ledger;
    this.bidder = bidder;
    this.revealer = revealer;
    this.builderApi = builderApi;
    this.builderBidStreamApi = builderBidStreamApi;
    this.journal = journal;
    this.signingGuard = signingGuard;
    this.preferencesCache = preferencesCache;
    this.gossipIdentities = gossipIdentities;

    this.executionFeeRecipient = opts.executionFeeRecipient;

    this.blockObserver.runOnBlock((block) => this.revealer.onBlock(block));
    for (const identity of gossipIdentities) {
      this.blockObserver.runOnBlock((block) => identity.revealer.onBlock(block));
      this.clock.runEveryEpoch((epoch) => identity.builderStatusTracker.poll(epoch));
    }
    this.clock.runEverySlot(async (slot) => this.onSlot(slot));
    this.clock.runEveryEpoch((epoch) => this.builderStatusTracker.poll(epoch));
    this.clock.start(this.controller.signal);
    this.subscribeToEvents(opts.api);
    if (journal) void this.recoverHead(opts.api);
    void this.proposerPreferencesRecovery.refresh(this.clock.getCurrentSlot());

    this.logger.info("Builder client initialized", {
      index: this.index,
      executionFeeRecipient: toHex(this.executionFeeRecipient),
      payloadSource: opts.payloadSource.id,
      proposerPreferencesSources: this.proposerPreferencesRecovery.getSourceIds().join(","),
      shareBps: opts.bidding.shareBps,
      deadlineBps: opts.bidding.deadlineBps,
    });
  }

  static async init(opts: BuilderOptions): Promise<Builder> {
    const signingGuard = opts.commitmentDir ? await BuilderSigningGuard.acquire(opts.commitmentDir) : undefined;
    const startupJournals: AsyncCommitmentJournal[] = [];
    try {
      return await Builder.initOwned(opts, signingGuard, startupJournals);
    } catch (error) {
      signingGuard?.revoke();
      await Promise.allSettled(startupJournals.map((journal) => journal.close()));
      await signingGuard?.close();
      throw error;
    }
  }

  private static async initOwned(
    opts: BuilderOptions,
    signingGuard: BuilderSigningGuard | undefined,
    startupJournals: AsyncCommitmentJournal[]
  ): Promise<Builder> {
    const {api, logger} = opts;
    const additional = opts.gossipIdentities ?? [];
    if (additional.length > MAX_ADDITIONAL_GOSSIP_IDENTITIES) throw Error("GOSSIP_STAGE_LIMIT");
    if (additional.length && !opts.commitmentDir) throw Error("GOSSIP_STAGES_REQUIRE_COMMITMENT_DIRECTORY");
    if (
      additional.length &&
      (!opts.payloadSource.supportsUpdates || !(opts.bidding.updateIntervalMs && opts.bidding.updateIntervalMs > 0))
    )
      throw Error("GOSSIP_STAGES_REQUIRE_PAYLOAD_UPDATES");
    const pubkeys = new Set([toHex(opts.keypair.publicKey.toBytes())]);
    for (const entry of additional) {
      const pubkey = toHex(entry.keypair.publicKey.toBytes());
      if (pubkeys.has(pubkey)) throw Error("GOSSIP_STAGE_DUPLICATE_IDENTITY");
      pubkeys.add(pubkey);
    }
    validateGossipStages(
      {builderIndex: 0, deadlineBps: opts.bidding.deadlineBps},
      additional.map((item, i) => ({builderIndex: i + 1, deadlineBps: item.deadlineBps})),
      opts.bidding.updateCutoffBps ?? 1000
    );
    const genesis = await waitForGenesis(api, logger, opts.abortController.signal);
    logger.info("Genesis fetched from the beacon node", {
      genesisValidatorsRoot: toRootHex(genesis.genesisValidatorsRoot),
    });

    const specRes = await api.config.getSpec();
    assertEqualParams(opts.config, specRes.value());
    logger.info("Verified connected beacon node and builder have the same config");

    const config = createBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    const assertCanSign = signingGuard ? () => signingGuard.assertActive() : undefined;
    const builderSigner = new BuilderSigner(config, opts.keypair, assertCanSign);

    await waitForNodeReady(api, logger, opts.abortController.signal);
    await logNodeVersion(api, logger);

    const clock = new Clock(config, logger, {genesisTime: Number(genesis.genesisTime), ...opts.clock});

    const assumed = clock.getCurrentEpoch() < config.GLOAS_FORK_EPOCH ? opts.assumedIdentity : undefined;
    const identity = await resolveBuilderIdentity(
      api,
      logger,
      builderSigner.getPubkeyHex(),
      opts.abortController.signal,
      clock,
      config,
      assumed
    );
    const index = identity.index;

    const builderStatusTracker = new BuilderStatusTracker(
      api,
      logger,
      index,
      opts.metrics,
      {status: identity.status, balance: identity.builder.balance},
      assumed !== undefined ? builderSigner.getPubkeyHex() : undefined
    );
    // A builder resolved ahead of the fork is not known to the beacon node yet
    if (clock.getCurrentEpoch() >= config.GLOAS_FORK_EPOCH) {
      await builderStatusTracker.poll(clock.getCurrentEpoch());
    }
    const blockObserver = new BlockObserver(config, logger, api);
    const proposerPreferencesTracker = new ProposerPreferencesTracker();
    const proposerPreferencesRecovery = new ProposerPreferencesRecovery(
      {config, logger, tracker: proposerPreferencesTracker, metrics: opts.metrics, signal: opts.abortController.signal},
      {
        primary: {id: "primary", api},
        additional: opts.proposerPreferences?.sources ?? [],
        genesisValidatorsRoot: toRootHex(genesis.genesisValidatorsRoot),
        genesisTime: Number(genesis.genesisTime),
        timeoutMs: opts.proposerPreferences?.timeoutMs ?? defaultOptions.proposerPreferences.timeoutMs,
      }
    );

    if (opts.commitmentDir)
      assertGossipJournalsConfigured(
        opts.commitmentDir,
        new Set(additional.map(({keypair}) => toHex(keypair.publicKey.toBytes()))),
        clock.getCurrentSlot()
      );
    const payloadStore = new PayloadStore();
    const bidStore = new BidStore();
    const ledger = new BidLedger();
    let journal: AsyncCommitmentJournal | undefined;
    let preferencesCache: ProposerPreferencesCache | undefined;
    if (opts.commitmentDir) {
      const identity = {
        genesisValidatorsRoot: toRootHex(genesis.genesisValidatorsRoot),
        pubkey: builderSigner.getPubkeyHex(),
      };
      const recovery = new CommitmentJournal(opts.commitmentDir, identity, clock.getCurrentSlot());
      const recovered = recovery.recover(clock.getCurrentSlot(), payloadStore, bidStore, ledger);
      preferencesCache = new ProposerPreferencesCache(
        path.join(opts.commitmentDir, "proposer-preferences.json"),
        identity,
        logger
      );
      const recoveredPreferences = await preferencesCache.load(proposerPreferencesTracker, clock.getCurrentSlot());
      logger.info("Restored cached proposer preferences", {recovered: recoveredPreferences});
      journal = await AsyncCommitmentJournal.start({directory: opts.commitmentDir, identity});
      startupJournals.push(journal);
      logger.info("Recovered builder commitments", {recovered});
    }
    const signal = opts.abortController.signal;

    const revealer = new Revealer(
      {
        config,
        logger,
        clock,
        ledger,
        bidSelector: new BidSelector({config, ledger, builderIndex: index}),
        payloadStore,
        envelopePublisher: new EnvelopePublisher({
          api,
          signer: builderSigner,
          ledger,
          builderIndex: index,
          retainReveal: journal ? (record) => journal.retainReveal(record) : undefined,
        }),
        builderIndex: index,
        metrics: opts.metrics,
        signal,
      },
      {...opts.reveal, cutoffBps: opts.reveal.cutoffBps ?? config.PAYLOAD_ATTESTATION_DUE_BPS}
    );

    const builderApiModules = {
      config,
      logger,
      clock,
      api,
      bidStore,
      proposerDutiesTracker: new ProposerDutiesTracker(api, clock),
      builderIndex: index,
      metrics: opts.metrics,
      signal,
    };
    const builderApi = opts.builderApi ? getBuilderApi(builderApiModules, opts.builderApi) : null;
    const builderBidStreamApi = opts.builderApi ? getBuilderBidStreamApi(builderApiModules, opts.builderApi) : null;

    const gossipIdentities: GossipIdentity[] = [];
    try {
      for (const entry of additional) {
        const signer = new BuilderSigner(config, entry.keypair, assertCanSign);
        const identity = await resolveGossipBuilderIdentity(api, signer.getPubkeyHex(), signal);
        if ([index, ...gossipIdentities.map(({stage}) => stage.builderIndex)].includes(identity.index))
          throw Error("GOSSIP_STAGE_DUPLICATE_IDENTITY");
        const statusTracker = new BuilderStatusTracker(api, logger, identity.index, null, {
          status: identity.status,
          balance: identity.builder.balance,
        });
        const extraLedger = new BidLedger();
        const extraBidStore = new BidStore();
        if (!opts.commitmentDir) throw Error("GOSSIP_STAGES_REQUIRE_COMMITMENT_DIRECTORY");
        const directory = path.join(gossipJournalDirectory(opts.commitmentDir), signer.getPubkeyHex());
        const journalIdentity = {
          genesisValidatorsRoot: toRootHex(genesis.genesisValidatorsRoot),
          pubkey: signer.getPubkeyHex(),
        };
        const recovered = new CommitmentJournal(directory, journalIdentity, clock.getCurrentSlot()).recover(
          clock.getCurrentSlot(),
          payloadStore,
          extraBidStore,
          extraLedger
        );
        const extraJournal = await AsyncCommitmentJournal.start({
          directory,
          identity: journalIdentity,
          sharedPayloadDirectory: opts.commitmentDir,
        });
        startupJournals.push(extraJournal);
        const stage: GossipStage = {
          deadlineBps: entry.deadlineBps,
          builderIndex: identity.index,
          ledger: extraLedger,
          bidStore: extraBidStore,
          getBuilderStatus: () => statusTracker.getStatus(),
          bidPublisher: new BidPublisher({
            api,
            config,
            signer,
            ledger: extraLedger,
            builderIndex: identity.index,
            hasPayload: ({blockHash}) => payloadStore.has(blockHash),
            requireOfferContext: true,
            canSign: ({blockHash}, offered) =>
              isOrderOfferAllowed((offered ?? payloadStore.get(blockHash))?.payload.orderMetadata),
            retainCommitment: async (bid, offered) => {
              const stored = offered;
              if (!stored) throw Error("COMMITMENT_OFFER_MISSING");
              const started = performance.now();
              const reference = journal?.getReference(stored);
              const retentionMode = await extraJournal.retainShared(bid, stored, reference);
              logger.debug("Persisted staged builder commitment", {
                retentionMode,
                slot: bid.message.slot,
                builderIndex: identity.index,
                elapsedMs: performance.now() - started,
              });
            },
          }),
        };
        const extraRevealer = new Revealer(
          {
            config,
            logger,
            clock,
            ledger: extraLedger,
            payloadStore,
            bidSelector: new BidSelector({config, ledger: extraLedger, builderIndex: identity.index}),
            envelopePublisher: new EnvelopePublisher({
              api,
              signer,
              ledger: extraLedger,
              builderIndex: identity.index,
              retainReveal: (record) => extraJournal.retainReveal(record),
            }),
            builderIndex: identity.index,
            metrics: opts.metrics,
            signal,
          },
          {...opts.reveal, cutoffBps: opts.reveal.cutoffBps ?? config.PAYLOAD_ATTESTATION_DUE_BPS}
        );
        gossipIdentities.push({
          stage,
          builderStatusTracker: statusTracker,
          revealer: extraRevealer,
          journal: extraJournal,
        });
        logger.info("Initialized staged gossip identity", {
          builderIndex: identity.index,
          deadlineBps: entry.deadlineBps,
          recovered,
        });
      }
      const bidder = new Bidder(
        {
          gossipStages: gossipIdentities.map(({stage}) => stage),
          config,
          logger,
          clock,
          api,
          orchestrator: new PayloadOrchestrator(
            opts.payloadSource,
            {getPayloadTimeout: opts.bidding.getPayloadTimeout},
            signal
          ),
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
            requireOfferContext: true,
            canSign: ({blockHash}, offered) =>
              isOrderOfferAllowed((offered ?? payloadStore.get(blockHash))?.payload.orderMetadata),
            retainCommitment: journal
              ? async (bid, offered) => {
                  if (config.getForkName(bid.message.slot) !== ForkName.gloas)
                    throw Error("COMMITMENT_UNSUPPORTED_FORK");
                  const stored = offered;
                  if (!stored) throw Error("COMMITMENT_OFFER_MISSING");
                  const started = performance.now();
                  await journal.retain(bid, stored);
                  logger.debug("Persisted builder commitment", {
                    slot: bid.message.slot,
                    elapsedMs: performance.now() - started,
                  });
                }
              : undefined,
          }),
          bidStore,
          proposerPreferencesTracker,
          proposerDutiesTracker: builderApiModules.proposerDutiesTracker,
          canRetainAlternate: () => journal?.canRetainAlternate() === true,
          builderPubkey: fromHex(builderSigner.getPubkeyHex()),
          getBuilderStatus: () => builderStatusTracker.getStatus(),
          builderIndex: index,
          executionFeeRecipient: opts.executionFeeRecipient,
          metrics: opts.metrics,
          signal,
        },
        opts.bidding
      );

      return new Builder({
        preferencesCache,
        gossipIdentities,
        opts,
        builderSigner,
        blockObserver,
        builderStatusTracker,
        proposerPreferencesTracker,
        proposerPreferencesRecovery,
        clock,
        index,
        payloadStore,
        bidStore,
        ledger,
        bidder,
        revealer,
        builderApi,
        builderBidStreamApi,
        journal,
        signingGuard,
      });
    } catch (error) {
      await Promise.allSettled(startupJournals.map((item) => item.close()));
      throw error;
    }
  }

  private async onSlot(slot: number): Promise<void> {
    this.payloadStore.prune(slot);
    this.bidStore.prune(slot);
    this.proposerPreferencesTracker.prune(slot);
    this.ledger.settlePaymentsBefore(slot - PAYMENT_SETTLEMENT_SLOTS);
    this.ledger.prune(slot);
    void this.proposerPreferencesRecovery.refresh(slot);
    for (const identity of this.gossipIdentities) {
      identity.stage.bidStore.prune(slot);
      identity.stage.ledger.settlePaymentsBefore(slot - PAYMENT_SETTLEMENT_SLOTS);
      identity.stage.ledger.prune(slot);
    }
    await Promise.all(
      this.gossipIdentities.map(async (identity) => {
        try {
          await identity.journal?.prune(slot);
        } catch (error) {
          this.logger.error(
            "Failed to prune builder commitments",
            {slot, builderIndex: identity.stage.builderIndex},
            error as Error
          );
        }
      })
    );
    try {
      await this.journal?.prune(slot);
    } catch (error) {
      this.logger.error("Failed to prune builder commitments", {slot}, error as Error);
    }
    void this.preferencesCache?.save(this.proposerPreferencesTracker, this.clock.getCurrentSlot());
  }

  /** SSE does not replay a selection received while the process was offline. */
  private async recoverHead(api: ApiClient): Promise<void> {
    try {
      const response = await api.beacon.getBlockHeader({blockId: "head"}, {signal: this.controller.signal});
      const head = response.value();
      await this.blockObserver.processBlockEvent(
        {
          slot: head.header.message.slot,
          block: toRootHex(head.root),
          executionOptimistic: response.meta().executionOptimistic,
        },
        this.controller.signal
      );
    } catch (error) {
      if (!isErrorAborted(error)) this.logger.warn("Unable to recover current head selection", {}, error as Error);
    }
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
    this.signingGuard?.revoke();
    this.controller.abort();
    await Promise.all([
      this.preferencesCache?.close(this.proposerPreferencesTracker, this.clock.getCurrentSlot()),
      this.journal?.close(),
      ...this.gossipIdentities.map((identity) => identity.journal?.close()),
    ]);
    await this.signingGuard?.close();
  }
}
