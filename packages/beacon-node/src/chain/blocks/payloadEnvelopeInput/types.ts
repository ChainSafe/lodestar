import {ForkName, ForkPostGloas} from "@lodestar/params";
import {ColumnIndex, RootHex, SignedBeaconBlock, gloas} from "@lodestar/types";

export enum PayloadEnvelopeInputSource {
  gossip = "gossip",
  api = "api",
  engine = "engine",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
  recovery = "recovery",
}

export type SourceMeta = {
  source: PayloadEnvelopeInputSource;
  seenTimestampSec: number;
  peerIdStr?: string;
};

export type ColumnWithSource = SourceMeta & {
  columnSidecar: gloas.DataColumnSidecar;
};

export type CreateFromBlockProps = {
  blockRootHex: RootHex;
  block: SignedBeaconBlock<ForkPostGloas>;
  forkName: ForkName;
  sampledColumns: ColumnIndex[];
  custodyColumns: ColumnIndex[];
  timeCreatedSec: number;
  daOutOfRange: boolean;
};

export type AddPayloadEnvelopeProps = SourceMeta & {
  envelope: gloas.SignedExecutionPayloadEnvelope;
};
