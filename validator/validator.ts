// This file makes some naive assumptions surrounding the way RPC like calls will be made in ETH2.0
// Subject to change with future developments with Hobbits and wire protocol
import to from 'await-to-js';
import {ValidatorCtx} from "./types";
import {unlockWallet} from "./utils/wallet";
import RPCProvider from "./stubs";
import {ValidatorIndex} from "../src/types";
import BlockProcessingService from "./block";

class Validator {
  private ctx: ValidatorCtx;
  private logger: Function;
  private provider: RPCProvider;
  private validatorIndex: ValidatorIndex;
  private blockService: BlockProcessingService;
  public isActive: boolean;

  public constructor(ctx: ValidatorCtx) {
    this.ctx = ctx;
    this.logger = (msg: string) => console.log(msg);
    this.isActive = false;
  }

  /**
   * Main method that starts a client.
   * @returns {Promise<void>}
   */
  public async start(): Promise<void> {
    this.logger("Starting validator client...");

    await this.setupRPC();

    this.isActive = await this.isChainLive();
    this.validatorIndex = await this.getValidatorIndex();

    await this.setupServices();
    this.startServices();
  }

  private async setupServices(): Promise<void> {
    this.blockService = new BlockProcessingService(this.validatorIndex, this.provider, this.ctx.privateKey, this.logger);
    // TODO setup attestation service
  }

  /**
   * Establishes a connection to a specified beacon chain url.
   */
  private setupRPC(): void {
    this.logger("Setting up RPC connection...");
    // TODO below is stubbed.
    this.provider = new RPCProvider(this.ctx.rpcUrl);
    this.logger(`RPC connection successfully established ${this.ctx.rpcUrl}!`);
  }

  /**
   * Checks to see if the validator has been processed on the beacon chain.
   * @returns {Promise<ValidatorIndex>}
   */
  private async getValidatorIndex(): Promise<ValidatorIndex> {
    this.logger("Checking if validator has been processed...");
    const index = await this.provider.getValidatorIndex(this.ctx.publicKey);
    if (index) {
      this.logger("Validator has been processed!");
      return index;
    }
    setTimeout(this.getValidatorIndex, 1000);
  }

  /**
   * Recursively checks for the chain start log event from the ETH1.x deposit contract
   * @returns {Promise<boolean>}
   */
  private async isChainLive(): Promise<boolean> {
    this.logger("Checking if chain has started...");
    if (await this.provider.hasChainStarted()) {
      this.logger("Chain start has occured!");
      return true;
    }
    setTimeout(this.isChainLive, 1000);
  }

  /**
   * Creates a new block proccessing service and starts it.
   */
  private startServices(): void {
    this.logger("Starting all services...");

    this.blockService.start();
    // TODO start attestation service
  }
}

export default Validator;
