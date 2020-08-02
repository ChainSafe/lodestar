import fs from "fs";
import {ethers} from "ethers";

/**
 * Returns a connected ethers signer from a variety of provider options
 */
export async function getEthersSigner({
  keystorePath,
  keystorePassword,
  rpcUrl,
  rpcPassword,
  ipcPath,
}: {
  keystorePath?: string;
  keystorePassword?: string;
  rpcUrl?: string;
  rpcPassword?: string;
  ipcPath?: string;
}): Promise<ethers.Signer> {
  if (keystorePath) {
    const keystoreJson = fs.readFileSync(keystorePath, "utf8");
    const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, keystorePassword);
    const eth1Provider = rpcUrl
      ? new ethers.providers.JsonRpcProvider(rpcUrl)
      : ethers.getDefaultProvider();
    const providerWallet = wallet.connect(eth1Provider);
    return providerWallet;
  }

  if (rpcUrl) {
    const signer = new ethers.providers.JsonRpcProvider(rpcUrl).getSigner();
    if (rpcPassword) {
      signer.unlock(rpcPassword);
    }
    return signer;
  }
  
  if (ipcPath) {
    return new ethers.providers.IpcProvider(ipcPath).getSigner();
  }
  
  throw Error("Must supply either keystorePath, rpcUrl, or ipcPath");
}
