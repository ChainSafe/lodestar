import blgr from 'blgr';
import ethers from "ethers";
import to from 'await-to-js';
import {ValidatorCtx} from "./types";
import {unlockWallet} from "./utils/wallet";

export class Validator {
  private ctx: ValidatorCtx;
  private publicWallet: ethers.Wallet;
  private withdrawalWallet: ethers.Wallet;
  private logger: blgr;
  public constructor(ctx: ValidatorCtx, logger: blgr) {
    this.ctx = ctx;
    this.logger = logger;
  }

  private setupRPC(): void {
    this.logger.info("Setting up RPC connection...");
    // TODO connect to a beacon chain
    this.logger.info(`RPC connection successfully established ${this.ctx.rpcUrl}!`);
  }

  private async validateKeystores() {
    this.logger.info("Unlocking wallets...");

    // Attempt to unlock public wallet
    const [err1, publicWallet] = await to<ethers.Wallet>(unlockWallet(this.ctx.publicKeystore, this.ctx.publicKeystorePassword, "public wallet"));
    if (err1) throw new Error("Public wallet could not be unlocked!");
    this.publicWallet = publicWallet;

    // Attempt to unlock withdrawal wallet
    let [err2, withdrawalWallet] = await to<ethers.Wallet>(unlockWallet(this.ctx.withdrawalKeystore, this.ctx.withdrawalKeystorePassword, "withrawal wallet"));
    if (err2) throw new Error("Withdrawal wallet could not be unlocked!");
    this.withdrawalWallet = withdrawalWallet;

    this.logger.info("Wallets successfully unlocked!");
  }

  private async setup() {
    await this.validateKeystores();
    this.setupRPC();
  }

  public async start() {
    this.logger.info("Starting validator client...");
    await this.setup();
    this.logger.info("Validator client successfully started!")
  }
}
