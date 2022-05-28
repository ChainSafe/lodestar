import PeerId from "peer-id";
import {writeFile, readFile} from "../util/index.js";

export async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({keyType: "secp256k1"});
}

export function writePeerId(filepath: string, peerId: PeerId): void {
  writeFile(filepath, peerId.toJSON());
}

export async function readPeerId(filepath: string): Promise<PeerId> {
  return await PeerId.createFromJSON(readFile(filepath));
}

export async function initPeerId(filepath: string): Promise<void> {
  writePeerId(filepath, await createPeerId());
}
