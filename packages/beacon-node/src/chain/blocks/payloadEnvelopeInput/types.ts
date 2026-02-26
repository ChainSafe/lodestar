import {ForkPostGloas} from "@lodestar/params";
import {ColumnIndex, RootHex, SignedBeaconBlock, gloas} from "@lodestar/types";

export enum PayloadEnvelopeInputSource {
  gossip = "gossip",
  api = "api",
  engine = "engine",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
  recovery = "recovery",
}

/**
 * Metadata about the source of data for PayloadEnvelopeInput.
 */
export type SourceMeta = {
  source: PayloadEnvelopeInputSource;
  seenTimestampSec: number;
  peerIdStr?: string;
};

/**
 * Gloas data column sidecar with source metadata.
 * Uses gloas.DataColumnSidecar (not fulu.DataColumnSidecar).
 */
export type ColumnWithSource = SourceMeta & {
  columnSidecar: gloas.DataColumnSidecar;
};

/**
 * Props for creating a PayloadEnvelopeInput from a block.
 */
export type CreateFromBlockProps = {
  blockRootHex: RootHex;
  block: SignedBeaconBlock<ForkPostGloas>;
  sampledColumns: ColumnIndex[];
  custodyColumns: ColumnIndex[];
  timeCreatedSec: number;
};

/**
 * Props for adding a payload envelope to PayloadEnvelopeInput.
 */
export type AddPayloadEnvelopeProps = SourceMeta & {
  envelope: gloas.SignedExecutionPayloadEnvelope;
};
