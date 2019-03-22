import ethers from "ethers";
import blgr from "blgr";
const logger = blgr.logger('debug');

export function unlockWallet(keystorePath: string, keystorePassword: string, type: string): Promise<ethers.Wallet> {
  return ethers.Wallet.fromEncryptedJson(this.ctx.publicKeystore, this.ctx.publicKeystorePassword);
    // .then((wallet: ethers.Wallet) => {
    //   logger.info(`Successfully unlocked the public wallet - ${wallet.address}`);
    //   return wallet;
    // })
    // .catch((error: Error) => {
    //   logger.error("Could not unlock the public wallet!");
    //   console.log(error);
    //   return error;
    // });
}
