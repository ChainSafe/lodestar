import PeerId from "peer-id";
import sinon from "sinon";
import {PeerStoreBucket, IPeerMetadataStore} from "../../src/network/peers/metastore";

/**
 * Returns a valid PeerId with opts `bits: 256, keyType: "secp256k1"`
 * That will not throw `Error: invalid character 'L' in '6LmMVJCqrTm8C'` when parsed
 */
export function getValidPeerId(): PeerId {
  const id = Buffer.from("002508021221039481269fe831799b1a0f1d521c1395b4831514859e4559c44d155eae46f03819", "hex");
  return new PeerId(id);
}

function getStubbedMetadataStoreItem<T>(): sinon.SinonStubbedInstance<PeerStoreBucket<T>> {
  return {
    get: sinon.stub(),
    set: sinon.stub(),
  };
}

export type StubbedIPeerMetadataStore = {
  [K in keyof IPeerMetadataStore]: sinon.SinonStubbedInstance<IPeerMetadataStore[K]>;
};

export function getStubbedMetadataStore(): StubbedIPeerMetadataStore {
  return {
    encoding: getStubbedMetadataStoreItem(),
    metadata: getStubbedMetadataStoreItem(),
    rpcScore: getStubbedMetadataStoreItem(),
    rpcScoreLastUpdate: getStubbedMetadataStoreItem(),
  };
}
