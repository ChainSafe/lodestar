import type {PrivateKey} from "@libp2p/interface";
import {peerIdFromPrivateKey, peerIdFromString} from "@libp2p/peer-id";
import {
  privateKeyFromProtobuf,
  privateKeyToProtobuf,
  publicKeyFromProtobuf,
  publicKeyToProtobuf,
} from "@libp2p/crypto/keys";
import {fromString as uint8ArrayFromString} from "uint8arrays/from-string";
import {toString as uint8ArrayToString} from "uint8arrays/to-string";
import {writeFile600Perm, readFile} from "../util/index.js";

// Peer id to / from JSON taken from peer-id-factory
// See https://github.com/libp2p/js-libp2p-peer-id/pull/9 for more details

// after libp2p 2.0, PeerId no longer contains a private key
// but we retain a semi-backwards-compatible on-disk format
// Note: all properties are required
export type PeerIdJSON = {id: string; pubKey: string; privKey: string};

export function exportToJSON(privateKey: PrivateKey): PeerIdJSON {
  const publicKey = privateKey.publicKey;
  const peerId = peerIdFromPrivateKey(privateKey);
  return {
    id: peerId.toString(),
    pubKey: uint8ArrayToString(publicKeyToProtobuf(publicKey), "base64pad"),
    privKey: uint8ArrayToString(privateKeyToProtobuf(privateKey), "base64pad"),
  };
}

export function createFromJSON(obj: PeerIdJSON): PrivateKey {
  const privateKey = privateKeyFromProtobuf(uint8ArrayFromString(obj.privKey, "base64pad"));
  const publicKey = publicKeyFromProtobuf(uint8ArrayFromString(obj.pubKey, "base64pad"));
  const peerId = peerIdFromString(obj.id);
  if (!publicKey.equals(privateKey.publicKey)) {
    throw new Error("Public key does not match private key");
  }
  if (!peerId.equals(peerIdFromPrivateKey(privateKey))) {
    throw new Error("Peer ID does not match private key");
  }
  return privateKey;
}

export function writePrivateKey(filepath: string, privateKey: PrivateKey): void {
  writeFile600Perm(filepath, exportToJSON(privateKey));
}

export function readPrivateKey(filepath: string): PrivateKey {
  return createFromJSON(readFile(filepath));
}
