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
import {GenesisInfo, ValidatorCtx} from "./types";
import RPCProvider from "./stubs";
import {ValidatorIndex} from "../src/types";
import BlockProcessingService from "./block";
import {SLOTS_PER_EPOCH} from "../src/constants";
import {getCommitteeAssignment} from "./helpers";
import {getCurrentEpoch} from "../src/chain/helpers/stateTransitionHelpers";
import logger, {AbstractLogger} from "../src/logger";

/**
 * Main class for the Validator client.
 */
class Validator {
  private ctx: ValidatorCtx;
  private logger: AbstractLogger;
  private provider: RPCProvider;
  private validatorIndex: ValidatorIndex;
  private blockService: BlockProcessingService;
  private genesisInfo: GenesisInfo;
  public isActive: boolean;

  /**
   * @param {ValidatorCtx} ctx
   */
  public constructor(ctx: ValidatorCtx) {
    this.ctx = ctx;
    this.logger = logger;
    this.isActive = false;
  }

  /**
   * Creates a new block proccessing service and starts it.
   */
  private async start(): Promise<void> {
    await this.setup();
    this.startServices();
  }

  /**
   * Main method that starts a client.
   * @returns {Promise<void>}
   */
  public async setup(): Promise<void> {
    this.logger.info.info("Setting up validator client...");

    await this.setupRPC();

    // Wait for the ChainStart log and grab validator index
    this.isActive = await this.isChainLive();
    this.validatorIndex = await this.getValidatorIndex();

    await this.setupServices();
  }

  /**
   * Establishes a connection to a specified beacon chain url.
   */
  private setupRPC(): void {
    this.logger.info.info("Setting up RPC connection...");
    this.provider = new RPCProvider(this.ctx.rpcUrl);
    this.logger.info(`RPC connection successfully established ${this.ctx.rpcUrl}!`);
  }

  /**
   * Recursively checks for the chain start log event from the ETH1.x deposit contract
   * @returns {Promise<boolean>}
   */
  private async isChainLive(): Promise<boolean> {
    this.logger.info("Checking if chain has started...");
    if (await this.provider.hasChainStarted()) {
      this.genesisInfo = await this.provider.getGenisisInfo();
      this.logger.info("Chain start has occured!");
      return true;
    }
    setTimeout(this.isChainLive, 1000);
  }

  /**
   * Checks to see if the validator has been processed on the beacon chain.
   * @returns {Promise<ValidatorIndex>}
   */
  private async getValidatorIndex(): Promise<ValidatorIndex> {
    this.logger.info("Checking if validator has been processed...");
    const index = await this.provider.getValidatorIndex(this.ctx.publicKey);
    if (index) {
      this.logger.info("Validator has been processed!");
      return index;
    }
    setTimeout(this.getValidatorIndex, 1000);
  }

  /**
   * Setups the necessary services.
   * @returns {Promise<void>}
   */
  private async setupServices(): Promise<void> {
    this.blockService = new BlockProcessingService(this.validatorIndex, this.provider, this.ctx.privateKey, this.logger.info);
    // TODO setup attestation service
  }
  private startServices(): void {};

  private checkAssignment(): void {
    // If epoch boundary then look up for new assignment
    if ((Date.now() - this.genesisInfo.startTime) % SLOTS_PER_EPOCH === 0) {
      const epoch = getCurrentEpoch(this.ctx.state);
      // TODO check if validator exists or write helper for that
      const {validators, shard, slot} = getCommitteeAssignment(this.ctx.state, epoch, this.validatorIndex);
    }
  }
}

export default Validator;
