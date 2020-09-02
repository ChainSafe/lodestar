import PeerId from "peer-id";
import {Metadata, Status} from "@chainsafe/lodestar-types";
import {ReqRespEncoding} from "../../constants";

export interface IPeerMetadataStore {
  setStatus(peer: PeerId, status: Status | null): void;
  getStatus(peer: PeerId): Status | null;
  setScore(peer: PeerId, score: number | null): void;
  getScore(peer: PeerId): number | null;

  /**
   * It will never store metadata with lower seq number
   * @param peer
   * @param metadata
   */
  setMetadata(peer: PeerId, metadata: Metadata | null): void;
  getMetadata(peer: PeerId): Metadata | null;
  setEncoding(peer: PeerId, encoding: ReqRespEncoding | null): void;
  getEncoding(peer: PeerId): ReqRespEncoding | null;
}
