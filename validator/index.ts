// This file makes some naive assumptions surrounding the way RPC like calls will be made in ETH2.0
// Subject to change with future developments with Hobbits and wire protocol
import blgr from 'blgr';
import to from 'await-to-js';
import ethers from "ethers";
import {ValidatorCtx} from "./types";
import {unlockWallet} from "./utils/wallet";
import RPCProvider from "./stubs";
import {ValidatorIndex} from "../src/types";
import BlockProcessingService from "./block";

export class Validator {
  private ctx: ValidatorCtx;
  private publicWallet: ethers.Wallet;
  private logger: blgr;
  private provider: RPCProvider;
  private validatorIndex: ValidatorIndex;
  private blockService: BlockProcessingService;
  public isActive: boolean;

  public constructor(ctx: ValidatorCtx, logger: blgr) {
    this.ctx = ctx;
    this.logger = logger;
    this.isActive = false;
  }

  /**
   * Main method that starts a client.
   * @returns {Promise<void>}
   */
  public async start(): Promise<void> {
    this.logger.info("Starting validator client...");

    await this.setup();
    this.validatorIndex = await this.getValidatorIndex();
    this.isActive = await this.checkValidatorStatus();

    this.logger.info("Validator client successfully started!");

    this.processBlocks();
  }

  /**
   * Main method invoking all setup steps
   * @returns {Promise<void>}
   */
  private async setup(): Promise<void> {
    await this.setupKeystores();
    this.setupRPC();
  }

  /**
   * Establishes a connection to a specified beacon chain url.
   */
  private setupRPC(): void {
    this.logger.info("Setting up RPC connection...");
    // TODO below is stubbed.
    this.provider = new RPCProvider(this.ctx.rpcUrl, this.logger);
    this.logger.info(`RPC connection successfully established ${this.ctx.rpcUrl}!`);
  }

  /**
   * Sets up necessary keystores and checks that requirements are met.
   * @returns {Promise<void>}
   */
  private async setupKeystores(): Promise<void> {
    this.logger.info("Unlocking wallet...");

    // Attempt to unlock public wallet
    const [err1, publicWallet] = await to<ethers.Wallet>(unlockWallet(this.ctx.publicKeystore, this.ctx.publicKeystorePassword, "public wallet"));
    if (err1) {
      this.logger.Error("Public wallet could not be unlocked!");
    }
    this.publicWallet = publicWallet;

    this.logger.info("Wallet successfully unlocked!");
  }

  /**
   * Checks to see if the validator has been processed on the beacon chain.
   * @returns {Promise<ValidatorIndex>}
   */
  private async getValidatorIndex(): Promise<ValidatorIndex> {
    let index: ValidatorIndex;
    while (!index) {
      this.logger.info("Checking if validator has been processed...");
      index = await this.provider.getValidatorIndex(this.publicWallet.address);
    }
    this.logger.info("Validator has been processed!")
    return index;
  }

  /**
   * Checks to see if a validator is active.
   * @returns {Promise<boolean>}
   */
  private async checkValidatorStatus(): Promise<boolean> {
    let isValid = false;
    while (!isValid) {
      this.logger.info("Checking if validator is active...");
      isValid = await this.provider.isActiveValidator(this.validatorIndex);
    }
    this.logger.info("Validator is active!");
    return true;
  }

  /**
   * Creates a new block proccessing service and starts it.
   */
  private processBlocks(): void {
    this.blockService = new BlockProcessingService(this.validatorIndex, this.provider, this.logger);
    this.blockService.start();
  }
}
