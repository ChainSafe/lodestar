import {PeerId} from "@libp2p/interface";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {publicKeyFromProtobuf} from "@libp2p/crypto/keys";

/**
 * Returns a valid PeerId with opts `bits: 256, keyType: "secp256k1"`
 * That will not throw `Error: invalid character 'L' in '6LmMVJCqrTm8C'` when parsed
 */
export function getValidPeerId(): PeerId {
  const id = Buffer.from("002508021221039481269fe831799b1a0f1d521c1395b4831514859e4559c44d155eae46f03819", "hex");
  return peerIdFromPublicKey(publicKeyFromProtobuf(id));
}
