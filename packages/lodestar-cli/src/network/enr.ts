import PeerId from "peer-id";
import {ENR, createKeypairFromPeerId} from "@chainsafe/discv5";

import {readFileSync, writeFile} from "../util";
import {FileENR} from "../cmds/beacon/fileEnr";

export async function createEnr(peerId: PeerId): Promise<ENR> {
  const keypair = createKeypairFromPeerId(peerId);
  return ENR.createV4(keypair.publicKey);
}

export async function writeEnr(filename: string, enr: ENR, peerId: PeerId): Promise<void> {
  const keypair = createKeypairFromPeerId(peerId);
  await writeFile(filename, enr.encodeTxt(keypair.privateKey));
}

export async function readEnr(filename: string): Promise<ENR> {
  const enr = FileENR.decodeTxt(readFileSync(filename)) as FileENR;
  // Object.setPrototypeOf(enr, FileENR);
  // enr.filename = filename;
  return enr;
  // const enr = ENR.decodeTxt(await readFile(filename));
  // return enr;
  // return new FileENR(enr, filename, peerId);
}

export async function initEnr(filename: string, peerId: PeerId): Promise<void> {
  await writeEnr(filename, await createEnr(peerId), peerId);
}
