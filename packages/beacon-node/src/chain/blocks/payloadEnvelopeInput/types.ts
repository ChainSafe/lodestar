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

/**
 * Used to seed an entry from a state's `latestExecutionPayloadBid` (e.g., when initializing
 * the chain from a checkpoint anchor state — we have the bid via the state but not the
 * full SignedBeaconBlock).
 */
export type CreateFromBidProps = {
  blockRootHex: RootHex;
  slot: number;
  forkName: ForkName;
  proposerIndex: number;
  bid: gloas.ExecutionPayloadBid;
  sampledColumns: ColumnIndex[];
  custodyColumns: ColumnIndex[];
  timeCreatedSec: number;
  daOutOfRange: boolean;
};

export type AddPayloadEnvelopeProps = SourceMeta & {
  envelope: gloas.SignedExecutionPayloadEnvelope;
};
