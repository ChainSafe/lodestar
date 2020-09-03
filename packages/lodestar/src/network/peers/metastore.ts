import {IPeerMetadataStore} from "./interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ReqRespEncoding} from "../../constants";
import PeerId from "peer-id";
import {Metadata, Status} from "@chainsafe/lodestar-types";
import {BasicType, ContainerType} from "@chainsafe/ssz";
import {StringType} from "./sszTypes";
import {notNullish} from "../../util/notNullish";

enum MetadataKey {
  ENCODING = "encoding",
  METADATA = "metadata",
  SCORE = "score",
  STATUS = "status",
}

/**
 * Wrapper around Libp2p.peerstore.metabook
 * that uses ssz serialization to store data
 */
export class Libp2pPeerMetadataStore implements IPeerMetadataStore {
  private readonly config: IBeaconConfig;
  private readonly metabook: MetadataBook;

  constructor(config: IBeaconConfig, metabook: MetadataBook) {
    this.config = config;
    this.metabook = metabook;
  }

  public getEncoding(peer: PeerId): ReqRespEncoding | null {
    return this.get(peer, MetadataKey.ENCODING, new StringType()) as ReqRespEncoding | null;
  }

  public getMetadata(peer: PeerId): Metadata | null {
    return this.get(peer, MetadataKey.METADATA, this.config.types.Metadata);
  }

  public getScore(peer: PeerId): number | null {
    return this.get(peer, MetadataKey.SCORE, this.config.types.Number64);
  }

  public getStatus(peer: PeerId): Status | null {
    return this.get(peer, MetadataKey.STATUS, this.config.types.Status);
  }

  public setEncoding(peer: PeerId, encoding: ReqRespEncoding | null): void {
    return this.set(peer, MetadataKey.ENCODING, new StringType(), encoding);
  }

  public setMetadata(peer: PeerId, metadata: Metadata | null): void {
    if (!metadata) {
      //clears metadata
      return this.set(peer, MetadataKey.METADATA, this.config.types.Metadata, metadata);
    }
    const currentMetadata = this.getMetadata(peer);
    if (!currentMetadata || currentMetadata.seqNumber < metadata.seqNumber) {
      return this.set(peer, MetadataKey.METADATA, this.config.types.Metadata, metadata);
    }
  }

  public setScore(peer: PeerId, score: number | null): void {
    return this.set(peer, MetadataKey.SCORE, this.config.types.Number64, score);
  }

  public setStatus(peer: PeerId, status: Status | null): void {
    return this.set(peer, MetadataKey.STATUS, this.config.types.Status, status);
  }

  private set<T>(peer: PeerId, key: MetadataKey, type: BasicType<T> | ContainerType<T>, value: T | null): void {
    if (notNullish(value)) {
      this.metabook.set(peer, key, Buffer.from(type.serialize(value)));
    } else {
      this.metabook.deleteValue(peer, key);
    }
  }

  private get<T>(peer: PeerId, key: MetadataKey, type: BasicType<T> | ContainerType<T>): T | null {
    const value = this.metabook.getValue(peer, key);
    if (value) {
      return type.deserialize(value);
    } else {
      return null;
    }
  }
}
