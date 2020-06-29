import PeerId from "peer-id";
import {ENR, createKeypairFromPeerId} from "@chainsafe/discv5";

import {writeFile, readFile} from "../util";


export async function createEnr(peerId: PeerId): Promise<ENR> {
  const keypair = createKeypairFromPeerId(peerId);
  return ENR.createV4(keypair.publicKey);
}

export async function writeEnr(filename: string, enr: ENR, peerId: PeerId): Promise<void> {
  const keypair = createKeypairFromPeerId(peerId);
  await writeFile(filename, enr.encodeTxt(keypair.privateKey));
}

export async function readEnr(filename: string): Promise<ENR> {
  return ENR.decodeTxt(await readFile(filename));
}

export async function initEnr(filename: string, peerId: PeerId): Promise<void> {
  await writeEnr(filename, await createEnr(peerId), peerId);
}
