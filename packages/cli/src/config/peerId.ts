import {PeerId} from "@libp2p/interface-peer-id";
import {peerIdFromBytes} from "@libp2p/peer-id";
import {createFromPrivKey, createFromPubKey} from "@libp2p/peer-id-factory";
import {unmarshalPrivateKey, unmarshalPublicKey} from "@libp2p/crypto/keys";
import {fromString as uint8ArrayFromString} from "uint8arrays/from-string";
import {toString as uint8ArrayToString} from "uint8arrays/to-string";
import {writeFile600Perm, readFile} from "../util/index.js";

// Peer id to / from JSON taken from peer-id-factory
// See https://github.com/libp2p/js-libp2p-peer-id/pull/9 for more details

async function createFromParts(multihash: Uint8Array, privKey?: Uint8Array, pubKey?: Uint8Array): Promise<PeerId> {
  if (privKey != null) {
    const key = await unmarshalPrivateKey(privKey);

    return await createFromPrivKey(key);
  } else if (pubKey != null) {
    const key = unmarshalPublicKey(pubKey);

    return await createFromPubKey(key);
  }

  return peerIdFromBytes(multihash);
}

export type PeerIdJSON = {id: string; pubKey?: string; privKey?: string};

export function exportToJSON(peerId: PeerId, excludePrivateKey?: boolean): PeerIdJSON {
  return {
    id: uint8ArrayToString(peerId.toBytes(), "base58btc"),
    pubKey: peerId.publicKey != null ? uint8ArrayToString(peerId.publicKey, "base64pad") : undefined,
    privKey:
      excludePrivateKey === true || peerId.privateKey == null
        ? undefined
        : uint8ArrayToString(peerId.privateKey, "base64pad"),
  };
}

export async function createFromJSON(obj: PeerIdJSON): Promise<PeerId> {
  return await createFromParts(
    uint8ArrayFromString(obj.id, "base58btc"),
    obj.privKey != null ? uint8ArrayFromString(obj.privKey, "base64pad") : undefined,
    obj.pubKey != null ? uint8ArrayFromString(obj.pubKey, "base64pad") : undefined
  );
}

export function writePeerId(filepath: string, peerId: PeerId): void {
  writeFile600Perm(filepath, exportToJSON(peerId));
}

export async function readPeerId(filepath: string): Promise<PeerId> {
  return await createFromJSON(readFile(filepath));
}
