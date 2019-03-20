import blgr from 'blgr';
import ethers from "ethers";
import {ValidatorCtx} from "./types";
const logger = blgr.logger('debug');


export class Validator {
  ctx: ValidatorCtx;
  constructor(ctx: ValidatorCtx) {
    this.ctx= ctx;
  }

  setupRPC(): void {
    logger.info("Setting up RPC connection...");
    // TODO: Use ethers to connect to a BeaconChain node
    logger.info(`RPC connection successfully established ${this.ctx.rpcUrl}!`);
  }

  validateKeystores(): void {
    logger.info("Checking wallets...");

    // Attempt to unlock public wallet
    ethers.Wallet.fromEncryptedJson(this.ctx.publicKeystore, this.ctx.publicKeystorePassword)
      .then((wallet: ethers.Wallet) => logger.info(`Successfully unlocked the public wallet - ${wallet.address}`))
      .catch((error: Error) => {
        logger.error("Could not unlock the public wallet!");
        console.log(error);
        process.exit(1);
      });

    // Attempt to unlock withdrawal wallet
    ethers.Wallet.fromEncryptedJson(this.ctx.withdrawalKeystore, this.ctx.withdrawalKeystorePassword)
      .then((wallet: ethers.Wallet) => logger.info(`Successfully unlocked the withdrawal wallet - ${wallet.address}`))
      .catch((error: Error) => {
        logger.error("Could not unlock the withdrawal wallet!");
        console.log(error);
        process.exit(1);
      });

    logger.info("Wallets check success!");
  }

  setup(): void {
    this.validateKeystores();
    this.setupRPC();
  }

  start(): void {
    logger.info("Starting validator client...");
    this.setup();
    logger.info("Validator client successfully started!")
  }
}
