import {AbortController, AbortSignal} from "@chainsafe/abort-controller";
import {IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {ssz} from "@chainsafe/lodestar-types";
import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {Genesis} from "@chainsafe/lodestar-types/phase0";
import {ILogger} from "@chainsafe/lodestar-utils";
import {getClient, Api} from "@chainsafe/lodestar-api";
import {Clock, IClock} from "./util/clock";
import {waitForGenesis} from "./genesis";
import {BlockProposingService} from "./services/block";
import {AttestationService} from "./services/attestation";
import {IndicesService} from "./services/indices";
import {SyncCommitteeService} from "./services/syncCommittee";
import {ISlashingProtection} from "./slashingProtection";
import {assertEqualParams, getLoggerVc, NotEqualParamsError} from "./util";
import {ChainHeaderTracker} from "./services/chainHeaderTracker";
import {MetaDataRepository} from ".";
import {toHexString} from "@chainsafe/ssz";
import {ValidatorEventEmitter} from "./services/emitter";
import {ValidatorStore, Signer} from "./services/validatorStore";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";

export type ValidatorOptions = {
  slashingProtection: ISlashingProtection;
  dbOps: IDatabaseApiOptions;
  api: Api | string;
  signers: Signer[];
  logger: ILogger;
  graffiti?: string;
};

// TODO: Extend the timeout, and let it be customizable
/// The global timeout for HTTP requests to the beacon node.
// const HTTP_TIMEOUT_MS = 12 * 1000;

enum Status {
  running,
  stopped,
}

type State = {status: Status.running; controller: AbortController} | {status: Status.stopped};

/**
 * Main class for the Validator client.
 */
export class Validator {
  private readonly config: IBeaconConfig;
  private readonly api: Api;
  private readonly clock: IClock;
  private readonly emitter: ValidatorEventEmitter;
  private readonly chainHeaderTracker: ChainHeaderTracker;
  private readonly validatorStore: ValidatorStore;
  private readonly logger: ILogger;
  private state: State = {status: Status.stopped};

  constructor(opts: ValidatorOptions, genesis: Genesis) {
    const {dbOps, logger, slashingProtection, signers, graffiti} = opts;
    const config = createIBeaconConfig(dbOps.config, genesis.genesisValidatorsRoot);

    const api =
      typeof opts.api === "string"
        ? getClient(config, {
            baseUrl: opts.api,
            // Validator would need the beacon to respond within the slot
            timeoutMs: config.SECONDS_PER_SLOT * 1000,
            getAbortSignal: this.getAbortSignal,
          })
        : opts.api;

    const clock = new Clock(config, logger, {genesisTime: Number(genesis.genesisTime)});
    const validatorStore = new ValidatorStore(config, slashingProtection, signers, genesis);
    const indicesService = new IndicesService(logger, api, validatorStore);
    this.emitter = new ValidatorEventEmitter();
    this.chainHeaderTracker = new ChainHeaderTracker(logger, api, this.emitter);
    const loggerVc = getLoggerVc(logger, clock);
    new BlockProposingService(config, loggerVc, api, clock, validatorStore, graffiti);
    new AttestationService(loggerVc, api, clock, validatorStore, this.emitter, indicesService, this.chainHeaderTracker);
    new SyncCommitteeService(config, loggerVc, api, clock, validatorStore, this.chainHeaderTracker, indicesService);

    this.config = config;
    this.logger = logger;
    this.api = api;
    this.clock = clock;
    this.validatorStore = validatorStore;
  }

  /** Waits for genesis and genesis time */
  static async initializeFromBeaconNode(opts: ValidatorOptions, signal?: AbortSignal): Promise<Validator> {
    const {config} = opts.dbOps;
    const api =
      typeof opts.api === "string"
        ? // This new api instance can make do with default timeout as a faster timeout is
          // not necessary since this instance won't be used for validator duties
          getClient(config, {baseUrl: opts.api, getAbortSignal: () => signal})
        : opts.api;

    const genesis = await waitForGenesis(api, opts.logger, signal);
    opts.logger.info("Genesis available");

    const {data: externalSpecJson} = await api.config.getSpec();
    assertEqualParams(config, externalSpecJson);
    opts.logger.info("Verified node and validator have same config");

    await assertEqualGenesis(opts, genesis);
    opts.logger.info("Verified node and validator have same genesisValidatorRoot");

    return new Validator(opts, genesis);
  }

  /**
   * Instantiates block and attestation services and runs them once the chain has been started.
   */
  async start(): Promise<void> {
    if (this.state.status === Status.running) return;
    const controller = new AbortController();
    this.state = {status: Status.running, controller};
    const {signal} = controller;
    this.clock.start(signal);
    this.chainHeaderTracker.start(signal);
  }

  /**
   * Stops all validator functions.
   */
  async stop(): Promise<void> {
    if (this.state.status === Status.stopped) return;
    this.state.controller.abort();
    this.state = {status: Status.stopped};
  }

  /**
   * Perform a voluntary exit for the given validator by its key.
   */
  async voluntaryExit(publicKey: string, exitEpoch?: number): Promise<void> {
    const {data: stateValidators} = await this.api.beacon.getStateValidators("head", {indices: [publicKey]});
    const stateValidator = stateValidators[0];
    if (stateValidator === undefined) {
      throw new Error(`Validator pubkey ${publicKey} not found in state`);
    }

    if (exitEpoch === undefined) {
      const currentSlot = getCurrentSlot(this.config, this.clock.genesisTime);
      exitEpoch = computeEpochAtSlot(currentSlot);
    }

    const signedVoluntaryExit = await this.validatorStore.signVoluntaryExit(publicKey, stateValidator.index, exitEpoch);
    await this.api.beacon.submitPoolVoluntaryExit(signedVoluntaryExit);

    this.logger.info(`Submitted voluntary exit for ${publicKey} to the network`);
  }

  /** Provide the current AbortSignal to the api instance */
  private getAbortSignal = (): AbortSignal | undefined => {
    return this.state.status === Status.running ? this.state.controller.signal : undefined;
  };
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
