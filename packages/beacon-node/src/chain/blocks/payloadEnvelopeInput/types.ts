import {ForkName, ForkPostGloas} from "@lodestar/params";
import {ColumnIndex, RootHex, SignedBeaconBlock, gloas} from "@lodestar/types";

export enum PayloadEnvelopeInputSource {
  gossip = "gossip",
  api = "api",
  engine = "engine",
  byRange = "req_resp_by_range",
  byRoot = "req_resp_by_root",
  // Data-column reconstruction (KZG cell recovery), NOT a cache reload
  recovery = "recovery",
  // Entry reconstructed from the hot DB by SeenPayloadEnvelopeInput.getOrReload
  reload = "reload",
  // Entry seeded from a checkpoint anchor state's latestExecutionPayloadBid at chain init
  anchorState = "anchor_state",
}

/**
 * Reason a PayloadEnvelopeInput is evicted from SeenPayloadEnvelopeInput. Used for the `pruned` metric
 * label and the eviction log.
 * - belowParent: pruned below the new head's parent (canonical, FULL, all-columns)
 * - finalized: below the finalized slot
 * - prune: explicit prune by root
 * - cap: insertion-order backstop cap (MAX_PAYLOAD_ENVELOPE_INPUT_CACHE_SIZE)
 */
export type PayloadEnvelopeInputPruneReason = "belowParent" | "finalized" | "prune" | "cap";

export type SourceMeta = {
  source: PayloadEnvelopeInputSource;
  seenTimestampSec: number;
  peerIdStr?: string;
};

export type ColumnWithSource = SourceMeta & {
  columnSidecar: gloas.DataColumnSidecar;
};

export type CreateFromBlockProps = SourceMeta & {
  blockRootHex: RootHex;
  block: SignedBeaconBlock<ForkPostGloas>;
  forkName: ForkName;
  sampledColumns: ColumnIndex[];
  custodyColumns: ColumnIndex[];
  daOutOfRange: boolean;
};

/**
 * Used to seed an entry from a state's `latestExecutionPayloadBid` (e.g., when initializing
 * the chain from a checkpoint anchor state — we have the bid via the state but not the
 * full SignedBeaconBlock).
 */
export type CreateFromBidProps = SourceMeta & {
  blockRootHex: RootHex;
  slot: number;
  forkName: ForkName;
  proposerIndex: number;
  bid: gloas.ExecutionPayloadBid;
  sampledColumns: ColumnIndex[];
  custodyColumns: ColumnIndex[];
  daOutOfRange: boolean;
};

export type AddPayloadEnvelopeProps = SourceMeta & {
  envelope: gloas.SignedExecutionPayloadEnvelope;
};
