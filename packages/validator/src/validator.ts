import {IDatabaseApiOptions} from "@lodestar/db";
import {BLSPubkey, ssz} from "@lodestar/types";
import {createIBeaconConfig, IBeaconConfig} from "@lodestar/config";
import {Genesis} from "@lodestar/types/phase0";
import {ILogger} from "@lodestar/utils";
import {getClient, Api} from "@lodestar/api";
import {toHexString} from "@chainsafe/ssz";
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
import {ValidatorStore, Signer, ValidatorProposerConfig} from "./services/validatorStore.js";
import {ProcessShutdownCallback, PubkeyHex} from "./types.js";
import {Metrics} from "./metrics.js";
import {MetaDataRepository} from "./repositories/metaDataRepository.js";
import {DoppelgangerService} from "./services/doppelgangerService.js";

export type ValidatorOptions = {
  slashingProtection: ISlashingProtection;
  dbOps: IDatabaseApiOptions;
  api: Api | string | string[];
  signers: Signer[];
  logger: ILogger;
  processShutdownCallback: ProcessShutdownCallback;
  abortController: AbortController;
  afterBlockDelaySlotFraction?: number;
  scAfterBlockDelaySlotFraction?: number;
  doppelgangerProtectionEnabled?: boolean;
  closed?: boolean;
  valProposerConfig?: ValidatorProposerConfig;
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
  readonly validatorStore: ValidatorStore;
  private readonly slashingProtection: ISlashingProtection;
  private readonly blockProposingService: BlockProposingService;
  private readonly attestationService: AttestationService;
  private readonly syncCommitteeService: SyncCommitteeService;
  private readonly config: IBeaconConfig;
  private readonly api: Api;
  private readonly clock: IClock;
  private readonly chainHeaderTracker: ChainHeaderTracker;
  private readonly logger: ILogger;
  private state: Status;
  private readonly controller: AbortController;

  constructor(opts: ValidatorOptions, readonly genesis: Genesis, metrics: Metrics | null = null) {
    const {dbOps, logger, slashingProtection, signers, valProposerConfig} = opts;
    const config = createIBeaconConfig(dbOps.config, genesis.genesisValidatorsRoot);
    this.controller = opts.abortController;
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
          timeoutMs: config.SECONDS_PER_SLOT * 1000,
          getAbortSignal: () => this.controller.signal,
        },
        {config, logger, metrics: metrics?.restApiClient}
      );
    } else {
      api = opts.api;
    }

    const indicesService = new IndicesService(logger, api, metrics);
    const doppelgangerService = opts.doppelgangerProtectionEnabled
      ? new DoppelgangerService(logger, clock, api, indicesService, opts.processShutdownCallback, metrics)
      : null;

    const validatorStore = new ValidatorStore(
      config,
      slashingProtection,
      indicesService,
      doppelgangerService,
      metrics,
      signers,
      valProposerConfig,
      genesis.genesisValidatorsRoot
    );
    pollPrepareBeaconProposer(config, loggerVc, api, clock, validatorStore, metrics);
    pollBuilderValidatorRegistration(config, loggerVc, api, clock, validatorStore, metrics);

    const emitter = new ValidatorEventEmitter();
    // Validator event emitter can have more than 10 listeners in a normal course of operation
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    emitter.setMaxListeners(Infinity);

    const chainHeaderTracker = new ChainHeaderTracker(logger, api, emitter);

    this.blockProposingService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, metrics);

    this.attestationService = new AttestationService(
      loggerVc,
      api,
      clock,
      validatorStore,
      emitter,
      chainHeaderTracker,
      metrics,
      {afterBlockDelaySlotFraction: opts.afterBlockDelaySlotFraction}
    );

    this.syncCommitteeService = new SyncCommitteeService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      emitter,
      chainHeaderTracker,
      metrics,
      {scAfterBlockDelaySlotFraction: opts.scAfterBlockDelaySlotFraction}
    );

    this.config = config;
    this.logger = logger;
    this.api = api;
    this.clock = clock;
    this.validatorStore = validatorStore;
    this.chainHeaderTracker = chainHeaderTracker;
    this.slashingProtection = slashingProtection;

    if (metrics) {
      opts.dbOps.controller.setMetrics(metrics.db);
    }

    if (opts.closed) {
      this.state = Status.closed;
    } else {
      // "start" the validator
      // Instantiates block and attestation services and runs them once the chain has been started.
      this.state = Status.running;
      this.clock.start(this.controller.signal);
      this.chainHeaderTracker.start(this.controller.signal);
    }
  }

  get isRunning(): boolean {
    return this.state === Status.running;
  }

  /** Waits for genesis and genesis time */
  static async initializeFromBeaconNode(opts: ValidatorOptions, metrics?: Metrics | null): Promise<Validator> {
    const {config} = opts.dbOps;
    const {logger} = opts;

    let api: Api;
    if (typeof opts.api === "string" || Array.isArray(opts.api)) {
      const urls = typeof opts.api === "string" ? [opts.api] : opts.api;
      // This new api instance can make do with default timeout as a faster timeout is
      // not necessary since this instance won't be used for validator duties
      api = getClient({urls, getAbortSignal: () => opts.abortController.signal}, {config, logger});
    } else {
      api = opts.api;
    }

    const genesis = await waitForGenesis(api, opts.logger, opts.abortController.signal);
    logger.info("Genesis fetched from the beacon node");

    const {data: externalSpecJson} = await api.config.getSpec();
    assertEqualParams(config, externalSpecJson);
    logger.info("Verified connected beacon node and validator have same the config");

    await assertEqualGenesis(opts, genesis);
    logger.info("Verified connected beacon node and validator have the same genesisValidatorRoot");

    return new Validator(opts, genesis, metrics);
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
    const {data: stateValidators} = await this.api.beacon.getStateValidators("head", {id: [publicKey]});
    const stateValidator = stateValidators[0];
    if (stateValidator === undefined) {
      throw new Error(`Validator pubkey ${publicKey} not found in state`);
    }

    if (exitEpoch === undefined) {
      exitEpoch = computeEpochAtSlot(getCurrentSlot(this.config, this.clock.genesisTime));
    }

    const signedVoluntaryExit = await this.validatorStore.signVoluntaryExit(publicKey, stateValidator.index, exitEpoch);
    await this.api.beacon.submitPoolVoluntaryExit(signedVoluntaryExit);

    this.logger.info(`Submitted voluntary exit for ${publicKey} to the network`);
  }
}

/** Assert the same genesisValidatorRoot and genesisTime */
async function assertEqualGenesis(opts: ValidatorOptions, genesis: Genesis): Promise<void> {
  const nodeGenesisValidatorRoot = genesis.genesisValidatorsRoot;
  const metaDataRepository = new MetaDataRepository(opts.dbOps);
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
