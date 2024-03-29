import fs from "node:fs";
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
  chainId,
}: {
  keystorePath?: string;
  keystorePassword?: string;
  rpcUrl?: string;
  rpcPassword?: string;
  ipcPath?: string;
  chainId: number;
}): Promise<ethers.Signer> {
  if (keystorePath && keystorePassword) {
    const keystoreJson = fs.readFileSync(keystorePath, "utf8");
    const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, keystorePassword);
    const eth1Provider = rpcUrl
      ? new ethers.JsonRpcProvider(rpcUrl)
      : new ethers.InfuraProvider({name: "deposit", chainId});
    return wallet.connect(eth1Provider);
  }

  if (rpcUrl) {
    const signer = await new ethers.JsonRpcProvider(rpcUrl).getSigner();
    if (rpcPassword) {
      await signer.unlock(rpcPassword);
    }
    return signer;
  }

  if (ipcPath) {
    return new ethers.IpcSocketProvider(ipcPath).getSigner();
  }

  throw Error("Must supply either keystorePath, rpcUrl, or ipcPath");
}
