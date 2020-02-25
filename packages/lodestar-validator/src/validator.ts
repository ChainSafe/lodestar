/**
 * @module validator
 */

// This file makes some naive assumptions surrounding the way RPC like calls will be made in ETH2.0
/**
 * 1. Setup any necessary connections (RPC,...)
 * 2. Check if the chain start log has been emitted
 * 3. Get the validator index
 * 4. Setup block processing and attestation services
 * 5. Wait for role change
 * 6. Execute role
 * 7. Wait for new role
 * 6. Repeat step 5
 */
import BlockProposingService from "./services/block";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IApiClient} from "./api";
import {AttestationService} from "./services/attestation";
import {IValidatorDB} from "./db/interface";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IValidatorOptions} from "./options";
import {ApiClientOverRest} from "./api/impl/rest/apiClient";
import {initBLS} from "@chainsafe/bls";

/**
 * Main class for the Validator client.
 */
export class Validator {
  private opts: IValidatorOptions;
  private config: IBeaconConfig;
  private apiClient: IApiClient;
  private blockService: BlockProposingService;
  private attestationService: AttestationService;
  private db: IValidatorDB;
  private logger: ILogger;
  private isRunning: boolean;

  public constructor(opts: IValidatorOptions) {
    this.opts = opts;
    this.config = opts.config;
    this.logger = opts.logger;
    this.isRunning = false;
    this.db = opts.db;
    this.apiClient = this.initApiClient(opts.api);
  }

  /**
   * Creates a new block processing service and starts it.
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    await initBLS();
    await this.setup();
    this.logger.info("Checking if chain has started...");
    this.apiClient.once("beaconChainStarted", this.run);
  }

  public run = (): void => {
    this.logger.info("Chain start has occured!");
    this.apiClient.onNewSlot(this.blockService.onNewSlot);
    this.apiClient.onNewEpoch(this.blockService.onNewEpoch);
    this.apiClient.onNewSlot(this.attestationService.onNewSlot);
    this.apiClient.onNewEpoch(this.attestationService.onNewEpoch);
    this.blockService.start();
    this.attestationService.start();
  };

  /**
   * Stops all validator functions
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    await this.apiClient.disconnect();
  }

  private initApiClient(api: string | IApiClient): IApiClient {
    if(typeof api === "string") {
      return new ApiClientOverRest(this.config, api, this.logger);
    }
    return api;
  }

  private async setup(): Promise<void> {
    this.logger.info("Setting up validator client...");
    await this.setupAPI();

    this.blockService = new BlockProposingService(
      this.config,
      this.opts.keypair,
      this.apiClient,
      this.db,
      this.logger
    );

    this.attestationService = new AttestationService(
      this.config,
      this.opts.keypair,
      this.apiClient,
      this.db,
      this.logger
    );
  }

  /**
   * Establishes a connection to a specified beacon chain url.
   */
  private async setupAPI(): Promise<void> {
    this.logger.info("Setting up RPC connection...");
    await this.apiClient.connect();
    this.logger.info(`RPC connection successfully established: ${this.apiClient.url}!`);
  }

}
