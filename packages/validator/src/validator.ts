import {BLSPubkey, phase0, ssz} from "@lodestar/types";
import {createBeaconConfig, BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {Genesis} from "@lodestar/types/phase0";
import {Logger, toPrintableUrl, toRootHex} from "@lodestar/utils";
import {getClient, ApiClient, routes, ApiRequestInit, defaultInit} from "@lodestar/api";
import {computeEpochAtSlot, getCurrentSlot} from "@lodestar/state-transition";
import {Clock, IClock} from "./util/clock.js";
import {waitForGenesis} from "./genesis.js";
import {BlockProposingService} from "./services/block.js";
import {AttestationService} from "./services/attestation.js";
import {IndicesService} from "./services/indices.js";
import {SyncCommitteeService} from "./services/syncCommittee.js";
import {pollPrepareBeaconProposer, pollBuilderValidatorRegistration} from "./services/prepareBeaconProposer.js";
import {ExternalSignerOptions, pollExternalSignerPubkeys} from "./services/externalSignerSync.js";
import {Interchange, InterchangeFormatVersion, ISlashingProtection} from "./slashingProtection/index.js";
import {assertEqualParams, getLoggerVc, NotEqualParamsError} from "./util/index.js";
import {ChainHeaderTracker} from "./services/chainHeaderTracker.js";
import {SyncingStatusTracker} from "./services/syncingStatusTracker.js";
import {ValidatorEventEmitter} from "./services/emitter.js";
import {ValidatorStore, Signer, ValidatorProposerConfig, defaultOptions} from "./services/validatorStore.js";
import {LodestarValidatorDatabaseController, ProcessShutdownCallback, PubkeyHex} from "./types.js";
import {Metrics} from "./metrics.js";
import {MetaDataRepository} from "./repositories/metaDataRepository.js";
import {DoppelgangerService} from "./services/doppelgangerService.js";

export type ValidatorModules = {
  opts: ValidatorOptions;
  genesis: Genesis;
  validatorStore: ValidatorStore;
  slashingProtection: ISlashingProtection;
  blockProposingService: BlockProposingService;
  attestationService: AttestationService;
  syncCommitteeService: SyncCommitteeService;
  config: BeaconConfig;
  api: ApiClient;
  clock: IClock;
  chainHeaderTracker: ChainHeaderTracker;
  syncingStatusTracker: SyncingStatusTracker;
  logger: Logger;
  db: LodestarValidatorDatabaseController;
  metrics: Metrics | null;
  controller: AbortController;
};

export type ValidatorOptions = {
  slashingProtection: ISlashingProtection;
  db: LodestarValidatorDatabaseController;
  config: ChainForkConfig;
  api: {
    clientOrUrls: ApiClient | string | string[];
    globalInit?: ApiRequestInit;
  };
  signers: Signer[];
  logger: Logger;
  processShutdownCallback: ProcessShutdownCallback;
  abortController: AbortController;
  afterBlockDelaySlotFraction?: number;
  scAfterBlockDelaySlotFraction?: number;
  disableAttestationGrouping?: boolean;
  doppelgangerProtection?: boolean;
  closed?: boolean;
  valProposerConfig?: ValidatorProposerConfig;
  distributed?: boolean;
  useProduceBlockV3?: boolean;
  broadcastValidation?: routes.beacon.BroadcastValidation;
  blindedLocal?: boolean;
  externalSigner?: ExternalSignerOptions;
};

// TODO: Extend the timeout, and let it be customizable
/// The global timeout for HTTP requests to the beacon node.
// const HTTP_TIMEOUT_MS = 12 * 1000;

enum Status {
  running,
  closed,
}

/**
 * Main class for the Validator client.
 */
export class Validator {
  private readonly genesis: Genesis;
  readonly validatorStore: ValidatorStore;
  private readonly slashingProtection: ISlashingProtection;
  private readonly blockProposingService: BlockProposingService;
  private readonly attestationService: AttestationService;
  private readonly syncCommitteeService: SyncCommitteeService;
  private readonly config: BeaconConfig;
  private readonly api: ApiClient;
  private readonly clock: IClock;
  private readonly chainHeaderTracker: ChainHeaderTracker;
  readonly syncingStatusTracker: SyncingStatusTracker;
  private readonly logger: Logger;
  private readonly db: LodestarValidatorDatabaseController;
  private state: Status;
  private readonly controller: AbortController;

  constructor({
    opts,
    genesis,
    validatorStore,
    slashingProtection,
    blockProposingService,
    attestationService,
    syncCommitteeService,
    config,
    api,
    clock,
    chainHeaderTracker,
    syncingStatusTracker,
    logger,
    db,
    metrics,
    controller,
  }: ValidatorModules) {
    this.genesis = genesis;
    this.validatorStore = validatorStore;
    this.slashingProtection = slashingProtection;
    this.blockProposingService = blockProposingService;
    this.attestationService = attestationService;
    this.syncCommitteeService = syncCommitteeService;
    this.config = config;
    this.api = api;
    this.clock = clock;
    this.chainHeaderTracker = chainHeaderTracker;
    this.syncingStatusTracker = syncingStatusTracker;
    this.logger = logger;
    this.controller = controller;
    this.db = db;

    if (opts.closed) {
      this.state = Status.closed;
    } else {
      // Add notifier to warn user if primary node is unhealthy as there might
      // not be any errors in the logs due to fallback nodes handling the requests
      const {httpClient} = this.api;
      if (httpClient.urlsInits.length > 1) {
        const primaryNodeUrl = toPrintableUrl(httpClient.urlsInits[0].baseUrl);

        this.clock.runEveryEpoch(async () => {
          // Only emit warning if URL score is 0 to prevent false positives
          // if just a single request fails which might happen due to other reasons
          if (httpClient.urlsScore[0] === 0) {
            this.logger.warn("Primary beacon node is unhealthy", {url: primaryNodeUrl});
          }
        });
      }

      if (metrics) {
        this.db.setMetrics(metrics.db);
      }

      // "start" the validator
      this.state = Status.running;
      this.clock.start(this.controller.signal);
      this.chainHeaderTracker.start(this.controller.signal);
    }
  }

  get isRunning(): boolean {
    return this.state === Status.running;
  }

  /**
   * Initialize and start a validator client
   */
  static async init(opts: ValidatorOptions, genesis: Genesis, metrics: Metrics | null = null): Promise<Validator> {
    const {db, config: chainConfig, logger, slashingProtection, signers, valProposerConfig} = opts;
    const config = createBeaconConfig(chainConfig, genesis.genesisValidatorsRoot);
    const controller = opts.abortController;
    const clock = new Clock(config, logger, {genesisTime: Number(genesis.genesisTime)});
    const loggerVc = getLoggerVc(logger, clock);

    let api: ApiClient;
    const {clientOrUrls, globalInit} = opts.api;
    if (typeof clientOrUrls === "string" || Array.isArray(clientOrUrls)) {
      api = getClient(
        {
          urls: typeof clientOrUrls === "string" ? [clientOrUrls] : clientOrUrls,
          // Validator would need the beacon to respond within the slot
          // See https://github.com/ChainSafe/lodestar/issues/5315 for rationale
          globalInit: {timeoutMs: config.SECONDS_PER_SLOT * 1000, signal: controller.signal, ...globalInit},
        },
        {config, logger, metrics: metrics?.restApiClient}
      );
    } else {
      api = clientOrUrls;
    }

    const indicesService = new IndicesService(logger, api, metrics);

    const doppelgangerService = opts.doppelgangerProtection
      ? new DoppelgangerService(
          logger,
          clock,
          api,
          indicesService,
          slashingProtection,
          opts.processShutdownCallback,
          metrics
        )
      : null;

    const validatorStore = await ValidatorStore.init(
      {
        config,
        slashingProtection,
        indicesService,
        doppelgangerService,
        metrics,
      },
      signers,
      valProposerConfig
    );
    pollPrepareBeaconProposer(config, loggerVc, api, clock, validatorStore, metrics);
    pollBuilderValidatorRegistration(config, loggerVc, api, clock, validatorStore, metrics);
    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, opts.externalSigner);

    const emitter = new ValidatorEventEmitter();
    // Validator event emitter can have more than 10 listeners in a normal course of operation
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    emitter.setMaxListeners(Infinity);

    const chainHeaderTracker = new ChainHeaderTracker(logger, api, emitter);
    const syncingStatusTracker = new SyncingStatusTracker(logger, api, clock, metrics);

    const blockProposingService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, metrics, {
      useProduceBlockV3: opts.useProduceBlockV3,
      broadcastValidation: opts.broadcastValidation ?? defaultOptions.broadcastValidation,
      blindedLocal: opts.blindedLocal ?? defaultOptions.blindedLocal,
    });

    const attestationService = new AttestationService(
      loggerVc,
      api,
      clock,
      validatorStore,
      emitter,
      chainHeaderTracker,
      syncingStatusTracker,
      metrics,
      config,
      {
        afterBlockDelaySlotFraction: opts.afterBlockDelaySlotFraction,
        disableAttestationGrouping: opts.disableAttestationGrouping || opts.distributed,
        distributedAggregationSelection: opts.distributed,
      }
    );

    const syncCommitteeService = new SyncCommitteeService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      emitter,
      chainHeaderTracker,
      syncingStatusTracker,
      metrics,
      {
        scAfterBlockDelaySlotFraction: opts.scAfterBlockDelaySlotFraction,
        distributedAggregationSelection: opts.distributed,
      }
    );

    return new this({
      opts,
      genesis,
      validatorStore,
      slashingProtection,
      blockProposingService,
      attestationService,
      syncCommitteeService,
      config,
      api,
      clock,
      chainHeaderTracker,
      syncingStatusTracker,
      logger,
      db,
      metrics,
      controller,
    });
  }

  /** Waits for genesis and genesis time */
  static async initializeFromBeaconNode(opts: ValidatorOptions, metrics?: Metrics | null): Promise<Validator> {
    const {logger, config} = opts;

    let api: ApiClient;
    const {clientOrUrls, globalInit} = opts.api;
    if (typeof clientOrUrls === "string" || Array.isArray(clientOrUrls)) {
      const urls = typeof clientOrUrls === "string" ? [clientOrUrls] : clientOrUrls;
      // This new api instance can make do with default timeout as a faster timeout is
      // not necessary since this instance won't be used for validator duties
      api = getClient({urls, globalInit: {signal: opts.abortController.signal, ...globalInit}}, {config, logger});
      logger.info("Beacon node", {
        urls: urls.map(toPrintableUrl).toString(),
        requestWireFormat: globalInit?.requestWireFormat ?? defaultInit.requestWireFormat,
        responseWireFormat: globalInit?.responseWireFormat ?? defaultInit.responseWireFormat,
      });
    } else {
      api = clientOrUrls;
    }

    const genesis = await waitForGenesis(api, opts.logger, opts.abortController.signal);
    logger.info("Genesis fetched from the beacon node");

    const res = await api.config.getSpec();
    assertEqualParams(config, res.value());
    logger.info("Verified connected beacon node and validator have same the config");

    await assertEqualGenesis(opts, genesis);
    logger.info("Verified connected beacon node and validator have the same genesisValidatorRoot");

    const {useProduceBlockV3, broadcastValidation = defaultOptions.broadcastValidation, valProposerConfig} = opts;
    const defaultBuilderSelection =
      valProposerConfig?.defaultConfig.builder?.selection ?? defaultOptions.builderSelection;
    const strictFeeRecipientCheck = valProposerConfig?.defaultConfig.strictFeeRecipientCheck ?? false;
    const suggestedFeeRecipient = valProposerConfig?.defaultConfig.feeRecipient ?? defaultOptions.suggestedFeeRecipient;

    logger.info("Initializing validator", {
      // if no explicit option is provided, useProduceBlockV3 will be auto enabled on/post deneb
      useProduceBlockV3: useProduceBlockV3 === undefined ? "deneb+" : useProduceBlockV3,
      broadcastValidation,
      defaultBuilderSelection,
      suggestedFeeRecipient,
      strictFeeRecipientCheck,
    });

    // Instantiates block and attestation services and runs them once the chain has been started.
    return Validator.init(opts, genesis, metrics);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.blockProposingService.removeDutiesForKey(pubkey);
    this.attestationService.removeDutiesForKey(pubkey);
    this.syncCommitteeService.removeDutiesForKey(pubkey);
  }

  /**
   * Stops all validator functions.
   */
  async close(): Promise<void> {
    if (this.state === Status.closed) return;
    this.controller.abort();
    await this.db.close();
    this.state = Status.closed;
  }

  async importInterchange(interchange: Interchange): Promise<void> {
    return this.slashingProtection.importInterchange(interchange, this.genesis.genesisValidatorsRoot);
  }

  async exportInterchange(pubkeys: BLSPubkey[], formatVersion: InterchangeFormatVersion): Promise<Interchange> {
    return this.slashingProtection.exportInterchange(this.genesis.genesisValidatorsRoot, pubkeys, formatVersion);
  }

  /**
   * Perform a voluntary exit for the given validator by its key.
   */
  async voluntaryExit(publicKey: string, exitEpoch?: number): Promise<void> {
    const signedVoluntaryExit = await this.signVoluntaryExit(publicKey, exitEpoch);

    (await this.api.beacon.submitPoolVoluntaryExit({signedVoluntaryExit})).assertOk();

    this.logger.info(`Submitted voluntary exit for ${publicKey} to the network`);
  }

  /**
   * Create a signed voluntary exit message for the given validator by its key.
   */
  async signVoluntaryExit(publicKey: string, exitEpoch?: number): Promise<phase0.SignedVoluntaryExit> {
    const validators = (
      await this.api.beacon.postStateValidators({stateId: "head", validatorIds: [publicKey]})
    ).value();

    const validator = validators[0];
    if (validator === undefined) {
      throw new Error(`Validator pubkey ${publicKey} not found in state`);
    }

    if (exitEpoch === undefined) {
      exitEpoch = computeEpochAtSlot(getCurrentSlot(this.config, this.clock.genesisTime));
    }

    return this.validatorStore.signVoluntaryExit(publicKey, validator.index, exitEpoch);
  }
}

/** Assert the same genesisValidatorRoot and genesisTime */
async function assertEqualGenesis(opts: ValidatorOptions, genesis: Genesis): Promise<void> {
  const nodeGenesisValidatorRoot = genesis.genesisValidatorsRoot;
  const metaDataRepository = new MetaDataRepository(opts.db);
  const genesisValidatorsRoot = await metaDataRepository.getGenesisValidatorsRoot();
  if (genesisValidatorsRoot) {
    if (!ssz.Root.equals(genesisValidatorsRoot, nodeGenesisValidatorRoot)) {
      // this happens when the existing validator db served another network before
      opts.logger.error("Not the same genesisValidatorRoot", {
        expected: toRootHex(nodeGenesisValidatorRoot),
        actual: toRootHex(genesisValidatorsRoot),
      });
      throw new NotEqualParamsError("Not the same genesisValidatorRoot");
    }
  } else {
    await metaDataRepository.setGenesisValidatorsRoot(nodeGenesisValidatorRoot);
    opts.logger.info("Persisted genesisValidatorRoot", toRootHex(nodeGenesisValidatorRoot));
  }

  const nodeGenesisTime = genesis.genesisTime;
  const genesisTime = await metaDataRepository.getGenesisTime();
  if (genesisTime !== null) {
    if (genesisTime !== nodeGenesisTime) {
      opts.logger.error("Not the same genesisTime", {expected: nodeGenesisTime, actual: genesisTime});
      throw new NotEqualParamsError("Not the same genesisTime");
    }
  } else {
    await metaDataRepository.setGenesisTime(nodeGenesisTime);
    opts.logger.info("Persisted genesisTime", nodeGenesisTime);
  }
}
