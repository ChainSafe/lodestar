import MetadataBook from "libp2p/src/peer-store/metadata-book";
import PeerId from "peer-id";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {ReqRespEncoding} from "../reqresp";
import {Type} from "@chainsafe/ssz";

/**
 * Get/set data about peers.
 */
export interface IPeerMetadataStore {
  encoding: PeerStoreBucket<ReqRespEncoding>;
  metadata: PeerStoreBucket<altair.Metadata>;
  rpcScore: PeerStoreBucket<number>;
  rpcScoreLastUpdate: PeerStoreBucket<number>;
}

export type PeerStoreBucket<T> = {
  set: (peer: PeerId, value: T) => void;
  get: (peer: PeerId) => T | undefined;
};

type BucketSerdes<T> = {
  serialize: (value: T) => Uint8Array;
  deserialize: (data: Uint8Array) => T;
};

/**
 * Wrapper around Libp2p.peerstore.metabook
 * that uses ssz serialization to store data
 */
export class Libp2pPeerMetadataStore implements IPeerMetadataStore {
  encoding: PeerStoreBucket<ReqRespEncoding>;
  metadata: PeerStoreBucket<altair.Metadata>;
  rpcScore: PeerStoreBucket<number>;
  rpcScoreLastUpdate: PeerStoreBucket<number>;

  private readonly metabook: MetadataBook;

  constructor(metabook: MetadataBook) {
    this.metabook = metabook;

    const number64Serdes = typeToSerdes(ssz.Number64);
    const metadataV2Serdes = typeToSerdes(ssz.altair.Metadata);
    const stringSerdes: BucketSerdes<ReqRespEncoding> = {
      serialize: (v) => Buffer.from(v, "utf8"),
      deserialize: (b) => Buffer.from(b).toString("utf8") as ReqRespEncoding,
    };
    const floatSerdes: BucketSerdes<number> = {
      serialize: (f) => Buffer.from(String(f), "utf8"),
      deserialize: (b) => parseFloat(Buffer.from(b).toString("utf8")),
    };

    this.encoding = this.typedStore("encoding", stringSerdes);
    // Discard existing `metadata` stored values. Store both phase0 and altair Metadata objects as altair
    // Serializing altair.Metadata instead of phase0.Metadata has a cost of just `SYNC_COMMITTEE_SUBNET_COUNT // 8` bytes
    this.metadata = this.typedStore("metadata-altair", metadataV2Serdes);
    this.rpcScore = this.typedStore("score", floatSerdes);
    this.rpcScoreLastUpdate = this.typedStore("score-last-update", number64Serdes);
  }

  private typedStore<T>(key: string, type: BucketSerdes<T>): PeerStoreBucket<T> {
    return {
      set: (peer: PeerId, value: T): void => {
        if (value != null) {
          // TODO: fix upstream type (which also contains @ts-ignore)
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          this.metabook.set(peer, key, Buffer.from(type.serialize(value)));
        } else {
          this.metabook.deleteValue(peer, key);
        }
      },
      get: (peer: PeerId): T | undefined => {
        const value = this.metabook.getValue(peer, key);
        return value ? type.deserialize(value) : undefined;
      },
    };
  }
}

function typeToSerdes<T>(type: Type<T>): BucketSerdes<T> {
  return {
    serialize: (v) => type.serialize(v),
    deserialize: (b) => type.deserialize(b),
  };
}
