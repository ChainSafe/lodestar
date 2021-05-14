import {AbortController, AbortSignal} from "abort-controller";
import {SecretKey} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Genesis} from "@chainsafe/lodestar-types/phase0";
import {fromHex, ILogger} from "@chainsafe/lodestar-utils";
import {ApiClientOverInstance, IApiClientValidator} from "./api";
import {ApiClientOverRest} from "./api/rest";
import {IValidatorOptions} from "./options";
import {Clock, IClock} from "./util/clock";
import {signAndSubmitVoluntaryExit} from "./voluntaryExit";
import {waitForGenesis} from "./genesis";
import {ForkService} from "./services/fork";
import {ValidatorStore} from "./services/validatorStore";
import {BlockProposingService} from "./services/block";
import {AttestationService} from "./services/attestation";
import {IndicesService} from "./services/indices";
import {SyncCommitteeService} from "./services/syncCommittee";

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
  private readonly apiClient: IApiClientValidator;
  private readonly secretKeys: SecretKey[];
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private state: State = {status: Status.stopped};

  constructor(opts: IValidatorOptions, genesis: Genesis) {
    const {config, logger, slashingProtection, secretKeys, graffiti} = opts;

    const apiClient =
      typeof opts.api === "string" ? ApiClientOverRest(config, opts.api) : ApiClientOverInstance(opts.api);
    const clock = new Clock(config, logger, {genesisTime: Number(genesis.genesisTime)});
    const forkService = new ForkService(apiClient, logger, clock);
    const validatorStore = new ValidatorStore(config, forkService, slashingProtection, secretKeys, genesis);
    const indicesService = new IndicesService(logger, apiClient, validatorStore);
    new BlockProposingService(config, logger, apiClient, clock, validatorStore, graffiti);
    new AttestationService(config, logger, apiClient, clock, validatorStore, indicesService);
    new SyncCommitteeService(config, logger, apiClient, clock, validatorStore, indicesService);

    this.config = config;
    this.logger = logger;
    this.apiClient = apiClient;
    this.clock = clock;
    this.secretKeys = secretKeys;
  }

  /** Waits for genesis and genesis time */
  static async initializeFromBeaconNode(opts: IValidatorOptions, signal?: AbortSignal): Promise<Validator> {
    const apiClient = typeof opts.api === "string" ? ApiClientOverRest(opts.config, opts.api) : opts.api;
    const genesis = await waitForGenesis(apiClient, opts.logger, signal);
    opts.logger.info("Genesis available");
    return new Validator(opts, genesis);
  }

  /**
   * Instantiates block and attestation services and runs them once the chain has been started.
   */
  async start(): Promise<void> {
    if (this.state.status === Status.running) return;
    const controller = new AbortController();
    this.state = {status: Status.running, controller};

    this.clock.start(controller.signal);
    this.apiClient.registerAbortSignal(controller.signal);
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
  async voluntaryExit(publicKey: string, exitEpoch: number): Promise<void> {
    const secretKey = this.secretKeys.find((sk) =>
      this.config.types.BLSPubkey.equals(sk.toPublicKey().toBytes(), fromHex(publicKey))
    );
    if (!secretKey) throw new Error(`No matching secret key found for public key ${publicKey}`);

    await signAndSubmitVoluntaryExit(publicKey, exitEpoch, secretKey, this.apiClient, this.config);
    this.logger.info(`Submitted voluntary exit for ${publicKey} to the network`);
  }
}
