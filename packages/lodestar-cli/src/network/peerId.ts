import PeerId from "peer-id";
import {Json} from "@chainsafe/ssz";
import {writeFile, readFile} from "../util";

export async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({keyType: "secp256k1"});
}

export function writePeerId(filename: string, peerId: PeerId): void {
  writeFile(filename, peerId.toJSON() as Json);
}

export async function readPeerId(filename: string): Promise<PeerId> {
  return await PeerId.createFromJSON(readFile(filename));
}

export async function initPeerId(filename: string): Promise<void> {
  writePeerId(filename, await createPeerId());
}
