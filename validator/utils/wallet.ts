import ethers from "ethers";

export function unlockWallet(keystorePath: string, keystorePassword: string, type: string): Promise<ethers.Wallet> {
  return ethers.Wallet.fromEncryptedJson(keystorePath, this.ctx.publicKeystorePassword);
}
