import {toHexString} from "@chainsafe/ssz";
import {BLSPubkey, phase0, ssz} from "@lodestar/types";
import {createBeaconConfig, BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {Genesis} from "@lodestar/types/phase0";
import {Logger, toSafePrintableUrl} from "@lodestar/utils";
import {getClient, Api, routes, ApiError} from "@lodestar/api";
import {computeEpochAtSlot, getCurrentSlot} from "@lodestar/state-transition";
import {Clock, IClock} from "./util/clock.js";
import {waitForGenesis} from "./genesis.js";
import {BlockProposingService} from "./services/block.js";
import {AttestationService} from "./services/attestation.js";
import {IndicesService} from "./services/indices.js";
import {SyncCommitteeService} from "./services/syncCommittee.js";
import {pollPrepareBeaconProposer, pollBuilderValidatorRegistration} from "./services/prepareBeaconProposer.js";
import {Interchange, InterchangeFormatVersion, ISlashingProtection} from "./slashingProtection/index.js";
import {assertEqualParams, getLoggerVc, NotEqualParamsError} from "./util/index.js";
import {ChainHeaderTracker} from "./services/chainHeaderTracker.js";
import {ValidatorEventEmitter} from "./services/emitter.js";
import {ValidatorStore, Signer, ValidatorProposerConfig, defaultOptions} from "./services/validatorStore.js";
import {LodestarValidatorDatabaseController, ProcessShutdownCallback, PubkeyHex} from "./types.js";
import {BeaconHealth, Metrics} from "./metrics.js";
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
  api: Api;
  clock: IClock;
  chainHeaderTracker: ChainHeaderTracker;
  logger: Logger;
  db: LodestarValidatorDatabaseController;
  metrics: Metrics | null;
  controller: AbortController;
};

export type ValidatorOptions = {
  slashingProtection: ISlashingProtection;
  db: LodestarValidatorDatabaseController;
  config: ChainForkConfig;
  api: Api | string | string[];
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
  private readonly api: Api;
  private readonly clock: IClock;
  private readonly chainHeaderTracker: ChainHeaderTracker;
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
    this.logger = logger;
    this.controller = controller;
    this.db = db;

    if (opts.closed) {
      this.state = Status.closed;
    } else {
      // "start" the validator
      // Instantiates block and attestation services and runs them once the chain has been started.
      this.state = Status.running;
      this.clock.start(this.controller.signal);
      this.chainHeaderTracker.start(this.controller.signal);

      if (metrics) {
        this.db.setMetrics(metrics.db);

        this.clock.runEverySlot(() =>
          this.fetchBeaconHealth()
            .then((health) => metrics.beaconHealth.set(health))
            .catch((e) => this.logger.error("Error on fetchBeaconHealth", {}, e))
        );
      }
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

    let api: Api;
    if (typeof opts.api === "string" || Array.isArray(opts.api)) {
      // This new api instance can make do with default timeout as a faster timeout is
      // not necessary since this instance won't be used for validator duties
      api = getClient(
        {
          urls: typeof opts.api === "string" ? [opts.api] : opts.api,
          // Validator would need the beacon to respond within the slot
          // See https://github.com/ChainSafe/lodestar/issues/5315 for rationale
          timeoutMs: config.SECONDS_PER_SLOT * 1000,
          getAbortSignal: () => controller.signal,
        },
        {config, logger, metrics: metrics?.restApiClient}
      );
    } else {
      api = opts.api;
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

    const emitter = new ValidatorEventEmitter();
    // Validator event emitter can have more than 10 listeners in a normal course of operation
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    emitter.setMaxListeners(Infinity);

    const chainHeaderTracker = new ChainHeaderTracker(logger, api, emitter);

    const blockProposingService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, metrics, {
      useProduceBlockV3: opts.useProduceBlockV3 ?? defaultOptions.useProduceBlockV3,
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
      metrics,
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
      logger,
      db,
      metrics,
      controller,
    });
  }

  /** Waits for genesis and genesis time */
  static async initializeFromBeaconNode(opts: ValidatorOptions, metrics?: Metrics | null): Promise<Validator> {
    const {logger, config} = opts;

    let api: Api;
    if (typeof opts.api === "string" || Array.isArray(opts.api)) {
      const urls = typeof opts.api === "string" ? [opts.api] : opts.api;
      // This new api instance can make do with default timeout as a faster timeout is
      // not necessary since this instance won't be used for validator duties
      api = getClient({urls, getAbortSignal: () => opts.abortController.signal}, {config, logger});
      logger.info("Beacon node", {urls: urls.map(toSafePrintableUrl).toString()});
    } else {
      api = opts.api;
    }

    const genesis = await waitForGenesis(api, opts.logger, opts.abortController.signal);
    logger.info("Genesis fetched from the beacon node");

    const res = await api.config.getSpec();
    ApiError.assert(res, "Can not fetch spec from beacon node");
    assertEqualParams(config, res.response.data);
    logger.info("Verified connected beacon node and validator have same the config");

    await assertEqualGenesis(opts, genesis);
    logger.info("Verified connected beacon node and validator have the same genesisValidatorRoot");

    const {
      useProduceBlockV3 = defaultOptions.useProduceBlockV3,
      broadcastValidation = defaultOptions.broadcastValidation,
      valProposerConfig,
    } = opts;
    const defaultBuilderSelection =
      valProposerConfig?.defaultConfig.builder?.selection ?? defaultOptions.builderSelection;
    const strictFeeRecipientCheck = valProposerConfig?.defaultConfig.strictFeeRecipientCheck ?? false;
    const suggestedFeeRecipient = valProposerConfig?.defaultConfig.feeRecipient ?? defaultOptions.suggestedFeeRecipient;

    logger.info("Initializing validator", {
      useProduceBlockV3,
      broadcastValidation,
      defaultBuilderSelection,
      suggestedFeeRecipient,
      strictFeeRecipientCheck,
    });

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

    ApiError.assert(await this.api.beacon.submitPoolVoluntaryExit(signedVoluntaryExit));

    this.logger.info(`Submitted voluntary exit for ${publicKey} to the network`);
  }

  /**
   * Create a signed voluntary exit message for the given validator by its key.
   */
  async signVoluntaryExit(publicKey: string, exitEpoch?: number): Promise<phase0.SignedVoluntaryExit> {
    const res = await this.api.beacon.getStateValidators("head", {id: [publicKey]});
    ApiError.assert(res, "Can not fetch state validators from beacon node");

    const stateValidators = res.response.data;
    const stateValidator = stateValidators[0];
    if (stateValidator === undefined) {
      throw new Error(`Validator pubkey ${publicKey} not found in state`);
    }

    if (exitEpoch === undefined) {
      exitEpoch = computeEpochAtSlot(getCurrentSlot(this.config, this.clock.genesisTime));
    }

    return this.validatorStore.signVoluntaryExit(publicKey, stateValidator.index, exitEpoch);
  }

  private async fetchBeaconHealth(): Promise<BeaconHealth> {
    try {
      const {status: healthCode} = await this.api.node.getHealth();
      // API always returns http status codes
      // Need to find a way to return a custom enum type
      if ((healthCode as unknown as routes.node.NodeHealth) === routes.node.NodeHealth.READY) return BeaconHealth.READY;
      if ((healthCode as unknown as routes.node.NodeHealth) === routes.node.NodeHealth.SYNCING)
        return BeaconHealth.SYNCING;
      if ((healthCode as unknown as routes.node.NodeHealth) === routes.node.NodeHealth.NOT_INITIALIZED_OR_ISSUES)
        return BeaconHealth.NOT_INITIALIZED_OR_ISSUES;
      else return BeaconHealth.UNKNOWN;
    } catch (e) {
      // TODO: Filter by network error type
      return BeaconHealth.ERROR;
    }
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
        expected: toHexString(nodeGenesisValidatorRoot),
        actual: toHexString(genesisValidatorsRoot),
      });
      throw new NotEqualParamsError("Not the same genesisValidatorRoot");
    }
  } else {
    await metaDataRepository.setGenesisValidatorsRoot(nodeGenesisValidatorRoot);
    opts.logger.info("Persisted genesisValidatorRoot", toHexString(nodeGenesisValidatorRoot));
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
