import PeerId from "peer-id";
import {writeFile, readFile} from "../util/index.js";

export async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({keyType: "secp256k1"});
}

export async function createUint8ArrayPeerId(): Promise<PeerId> {
  const peerId = await PeerId.create({keyType: "secp256k1"});
  return await toUint8ArrayPeerId(peerId);
}

export async function toUint8ArrayPeerId(peerId: PeerId): Promise<PeerId> {
  const uint8ArrayPrivKey = new Uint8Array(peerId.privKey.bytes);
  return await PeerId.createFromPrivKey(uint8ArrayPrivKey);
}

export function writePeerId(filepath: string, peerId: PeerId): void {
  writeFile(filepath, peerId.toJSON());
}

export async function readPeerId(filepath: string): Promise<PeerId> {
  return await PeerId.createFromJSON(readFile(filepath));
}
