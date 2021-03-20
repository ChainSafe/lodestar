import PeerId from "peer-id";
import LibP2p from "libp2p";
import sinon from "sinon";
import {PeerStoreBucket, IPeerMetadataStore} from "../../src/network/peers/metastore";
import Peer = LibP2p.Peer;

export function generatePeer(id: PeerId): Peer {
  return {
    id,
    addresses: [],
    metadata: new Map<string, Buffer>(),
    protocols: [],
  };
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
    status: getStubbedMetadataStoreItem(),
  };
}
