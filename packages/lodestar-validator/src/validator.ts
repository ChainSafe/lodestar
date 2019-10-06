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
import {Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IApiClient} from "./rpc";
import {AttestationService} from "./services/attestation";
import {IValidatorDB} from "./db/interface";
import {ILogger} from "./logger/interface";
import {IValidatorOptions} from "./options";
import {computeEpochOfSlot} from "./util";
import {ApiClientOverRest} from "./rest/apiClient";

/**
 * Main class for the Validator client.
 */
class Validator {
  private opts: IValidatorOptions;
  private config: IBeaconConfig;
  private apiClient: IApiClient;
  // @ts-ignore
  private blockService: BlockProposingService;
  // @ts-ignore
  private attestationService: AttestationService;
  // @ts-ignore
  private db: IValidatorDB;
  private logger: ILogger;
  private isActive: boolean;
  private isRunning: boolean;

  public constructor(opts: IValidatorOptions) {
    this.opts = opts;
    this.config = opts.config;
    this.logger = opts.logger;
    this.isActive = false;
    this.isRunning = false;
    this.db = opts.db;
    this.apiClient = this.initApiClient(opts.api);
  }

  /**
   * Creates a new block processing service and starts it.
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    await this.setup();
    this.run();
  }

  /**
   * Stops all validator functions
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    await this.apiClient.disconnect();
  }

  private initApiClient(api: string | IApiClient): IApiClient {
    if(typeof api === "string") {
      return new ApiClientOverRest(api, this.logger);
    }
    return api;
  }

  private async setup(): Promise<void> {
    this.logger.info("Setting up validator client...");
    await this.setupAPI();

    // Wait for the ChainStart log and grab validator index
    this.isActive = await this.isChainLive();

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

  /**
   * Recursively checks for the chain start log event from the ETH1.x deposit contract
   */
  private isChainLive = async (): Promise<boolean> => {
    this.logger.info("Checking if chain has started...");
    const genesisTime =  await this.apiClient.beacon.getGenesisTime();
    if (genesisTime && (Date.now() / 1000) > genesisTime) {
      this.logger.info("Chain start has occured!");
      return true;
    }
    if(this.isRunning) {
      setTimeout(this.isChainLive, 1000);
    }
    return false;
  };

  private run(): void {
    this.apiClient.onNewSlot(this.checkDuties);
    // this.apiClient.onNewEpoch(this.lookAhead);
  }

  private checkDuties = async (slot: Slot): Promise<void> => {
    const validatorDuty =
      (await this.apiClient.validator.getDuties(
        [this.opts.keypair.publicKey.toBytesCompressed()],
        computeEpochOfSlot(this.config, slot))
      )[0];
    const {fork} = await this.apiClient.beacon.getFork();
    const isAttester = validatorDuty.attestationSlot === slot;
    const isProposer = validatorDuty.blockProposalSlot === slot;
    if (isAttester) {
      this.logger.info(`Validator is attester at slot ${slot} and shard ${validatorDuty.attestationShard}`);
      this.attestationService.createAndPublishAttestation(
        validatorDuty.attestationSlot,
        validatorDuty.attestationShard,
        fork
      );
    }
    if (isProposer) {
      this.logger.info(`Validator is proposer at slot ${slot}`);
      this.blockService.createAndPublishBlock(slot, fork);
    }
  };
}

export default Validator;
