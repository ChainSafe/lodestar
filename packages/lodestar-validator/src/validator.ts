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
 * 8. Repeat step 5
 */
import BlockProposingService from "./services/block";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IApiClient} from "./api";
import {AttestationService} from "./services/attestation";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IValidatorOptions} from "./options";
import {ApiClientOverRest} from "./api/impl/rest/apiClient";
import {ISlashingProtection} from "./slashingProtection";

/**
 * Main class for the Validator client.
 */
export class Validator {
  private opts: IValidatorOptions;
  private config: IBeaconConfig;
  private apiClient: IApiClient;
  private blockService?: BlockProposingService;
  private attestationService?: AttestationService;
  private slashingProtection: ISlashingProtection;
  private logger: ILogger;

  public constructor(opts: IValidatorOptions) {
    this.opts = opts;
    this.config = opts.config;
    this.logger = opts.logger;
    this.slashingProtection = opts.slashingProtection;
    this.apiClient = this.initApiClient(opts.api);
  }

  /**
   * Instantiates block and attestation services and runs them once the chain has been started.
   */
  public async start(): Promise<void> {
    await this.setup();
    this.logger.info("Checking if chain has started...");
    this.apiClient.once("beaconChainStarted", this.run);
  }

  /**
   * Start the blockService and attestationService.
   * Should only be called once the beacon chain has been started.
   */
  public run = async (): Promise<void> => {
    this.logger.info("Chain start has occured!");
    if (!this.blockService) throw Error("blockService not setup");
    if (!this.attestationService) throw Error("attestationService not setup");
    // Run both services at once to prevent missing first attestation
    await Promise.all([this.blockService.start(), this.attestationService.start()]);
  };

  /**
   * Stops all validator functions.
   */
  public async stop(): Promise<void> {
    await this.apiClient.disconnect();
    if (this.attestationService) await this.attestationService.stop();
    if (this.blockService) await this.blockService.stop();
  }

  /**
   * Create and return a new rest API client.
   */
  private initApiClient(api: string | IApiClient): IApiClient {
    if (typeof api === "string") {
      return new ApiClientOverRest(this.config, api, this.logger);
    }
    return api;
  }

  /**
   * Creates a new block processing service and attestation service.
   */
  private async setup(): Promise<void> {
    this.logger.info("Setting up validator client...");
    await this.setupAPI();

    this.blockService = new BlockProposingService(
      this.config,
      this.opts.secretKeys,
      this.apiClient,
      this.slashingProtection,
      this.logger,
      this.opts.graffiti
    );

    this.attestationService = new AttestationService(
      this.config,
      this.opts.secretKeys,
      this.apiClient,
      this.slashingProtection,
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
