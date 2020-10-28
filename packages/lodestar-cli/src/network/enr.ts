import PeerId from "peer-id";
import {ENR, createKeypairFromPeerId} from "@chainsafe/discv5";
import {FileENR} from "./fileEnr";

export async function createEnr(peerId: PeerId): Promise<ENR> {
  const keypair = createKeypairFromPeerId(peerId);
  return ENR.createV4(keypair.publicKey);
}

export async function initEnr(filename: string, peerId: PeerId): Promise<void> {
  FileENR.initFromENR(filename, peerId, (await createEnr(peerId)) as FileENR).saveToFile();
}
