import PeerId from "peer-id";
import {Metadata, Status} from "@chainsafe/lodestar-types";
import {ReqRespEncoding} from "../../constants";

export interface IPeerMetadataStore {
  setStatus(peer: PeerId, status: Status): void;
  getStatus(peer: PeerId): Status | null;
  setScore(peer: PeerId, score: number): void;
  getScore(peer: PeerId): number | null;
  setMetadata(peer: PeerId, metadata: Metadata): void;
  getMetadata(peer: PeerId): Metadata | null;
  setEncoding(peer: PeerId, encoding: ReqRespEncoding): void;
  getEncoding(peer: PeerId): ReqRespEncoding | null;
}
