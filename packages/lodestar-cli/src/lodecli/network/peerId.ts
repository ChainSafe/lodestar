import PeerId from "peer-id";

import {writeFile, readFile} from "../util";

export async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({keyType: "secp256k1"});
}

export async function writePeerId(filename: string, peerId: PeerId): Promise<void> {
  await writeFile(filename, peerId.toJSON());
}

export async function readPeerId(filename: string): Promise<PeerId> {
  return await PeerId.createFromJSON(await readFile(filename));
}

export async function initPeerId(filename: string): Promise<void> {
  await writePeerId(filename, await createPeerId());
}
