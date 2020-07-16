import fs from "fs";
import {ethers} from "ethers";
import {YargsError} from "./errors";

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
    wallet.connect(eth1Provider);
    return wallet;
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
  
  throw new YargsError("Must supply either keystorePath, rpcUrl, or ipcPath");
}