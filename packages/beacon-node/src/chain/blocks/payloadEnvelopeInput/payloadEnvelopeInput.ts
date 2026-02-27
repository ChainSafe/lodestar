import {ColumnIndex, RootHex, Slot, ValidatorIndex, deneb, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {AddPayloadEnvelopeProps, ColumnWithSource, CreateFromBlockProps, SourceMeta} from "./types.js";

/**
 * Discriminated union for PayloadEnvelopeInput state.
 *
 * 4 possible states:
 * 1. No payload, no columns (initial state, or after adding columns without payload)
 * 2. No payload, all columns (waiting for payload)
 * 3. Has payload, no columns (waiting for columns)
 * 4. Complete (has payload and all columns)
 */
export type PayloadEnvelopeInputState =
  | {
      hasPayload: false;
      hasAllColumns: false;
    }
  | {
      hasPayload: false;
      hasAllColumns: true;
    }
  | {
      hasPayload: true;
      hasAllColumns: false;
      payloadEnvelope: gloas.SignedExecutionPayloadEnvelope;
      payloadEnvelopeSource: SourceMeta;
    }
  | {
      hasPayload: true;
      hasAllColumns: true;
      payloadEnvelope: gloas.SignedExecutionPayloadEnvelope;
      payloadEnvelopeSource: SourceMeta;
      timeCompleteSec: number;
    };

type PromiseParts<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: Error) => void;
};

function createPromise<T>(): PromiseParts<T> {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return {promise, resolve, reject};
}

/**
 * Tracks bid + payload envelope + data columns for a Gloas block.
 *
 * Created during block import from signedExecutionPayloadBid in block body.
 * Always has bid (required for creation).
 *
 * Completion requires: payload envelope + all sampled columns
 * (bid is always present from creation)
 */
export class PayloadEnvelopeInput {
  readonly blockRootHex: RootHex;
  readonly slot: Slot;
  readonly bid: gloas.ExecutionPayloadBid;
  readonly versionedHashes: VersionedHashes;

  private columnsCache = new Map<ColumnIndex, ColumnWithSource>();

  private readonly sampledColumns: ColumnIndex[];
  private readonly custodyColumns: ColumnIndex[];

  private timeCreatedSec: number;

  // Promise for waiting
  private readonly dataPromise: PromiseParts<gloas.SignedExecutionPayloadEnvelope>;

  state: PayloadEnvelopeInputState;

  private constructor(props: {
    blockRootHex: RootHex;
    slot: Slot;
    bid: gloas.ExecutionPayloadBid;
    sampledColumns: ColumnIndex[];
    custodyColumns: ColumnIndex[];
    timeCreatedSec: number;
  }) {
    this.blockRootHex = props.blockRootHex;
    this.slot = props.slot;
    this.bid = props.bid;
    this.versionedHashes = props.bid.blobKzgCommitments.map(kzgCommitmentToVersionedHash);
    this.sampledColumns = props.sampledColumns;
    this.custodyColumns = props.custodyColumns;
    this.timeCreatedSec = props.timeCreatedSec;
    this.dataPromise = createPromise();

    // Check if all columns already satisfied (no blobs = no columns needed)
    const noBlobs = props.bid.blobKzgCommitments.length === 0;
    const noSampledColumns = props.sampledColumns.length === 0;
    const hasAllColumns = noBlobs || noSampledColumns;

    this.state = hasAllColumns ? {hasPayload: false, hasAllColumns: true} : {hasPayload: false, hasAllColumns: false};
  }

  static createFromBlock(props: CreateFromBlockProps): PayloadEnvelopeInput {
    const bid = (props.block.message.body as gloas.BeaconBlockBody).signedExecutionPayloadBid.message;
    return new PayloadEnvelopeInput({
      blockRootHex: props.blockRootHex,
      slot: props.block.message.slot,
      bid,
      sampledColumns: props.sampledColumns,
      custodyColumns: props.custodyColumns,
      timeCreatedSec: props.timeCreatedSec,
    });
  }

  getBid(): gloas.ExecutionPayloadBid {
    return this.bid;
  }

  getBuilderIndex(): ValidatorIndex {
    return this.bid.builderIndex;
  }

  getBlockHashHex(): RootHex {
    return toRootHex(this.bid.blockHash);
  }

  getBlobKzgCommitments(): deneb.BlobKzgCommitments {
    return this.bid.blobKzgCommitments;
  }

  addPayloadEnvelope(props: AddPayloadEnvelopeProps): void {
    if (this.state.hasPayload) {
      throw new Error("Payload envelope already set");
    }
    // Validate beacon_block_root matches
    if (toRootHex(props.envelope.message.beaconBlockRoot) !== this.blockRootHex) {
      throw new Error("Payload envelope beacon_block_root mismatch");
    }

    const source: SourceMeta = {
      source: props.source,
      seenTimestampSec: props.seenTimestampSec,
      peerIdStr: props.peerIdStr,
    };

    // Transition state: hasPayload becomes true
    if (this.state.hasAllColumns) {
      // Complete state
      this.state = {
        hasPayload: true,
        hasAllColumns: true,
        payloadEnvelope: props.envelope,
        payloadEnvelopeSource: source,
        timeCompleteSec: props.seenTimestampSec,
      };
      this.dataPromise.resolve(props.envelope);
    } else {
      // Has payload, waiting for columns
      this.state = {
        hasPayload: true,
        hasAllColumns: false,
        payloadEnvelope: props.envelope,
        payloadEnvelopeSource: source,
      };
    }
  }

  addColumn(columnWithSource: ColumnWithSource): void {
    const {columnSidecar, seenTimestampSec} = columnWithSource;
    this.columnsCache.set(columnSidecar.index, columnWithSource);

    // Check if we now have all sampled columns
    const hasAllSampledColumns = this.sampledColumns.every((idx) => this.columnsCache.has(idx));
    const noBlobs = this.bid.blobKzgCommitments.length === 0;
    const hasAllColumns = hasAllSampledColumns || noBlobs || this.sampledColumns.length === 0;

    if (!hasAllColumns) {
      // Still waiting for more columns, state unchanged
      return;
    }

    // hasAllColumns is now true, transition state
    if (this.state.hasPayload) {
      // Complete state
      this.state = {
        hasPayload: true,
        hasAllColumns: true,
        payloadEnvelope: this.state.payloadEnvelope,
        payloadEnvelopeSource: this.state.payloadEnvelopeSource,
        timeCompleteSec: seenTimestampSec,
      };
      this.dataPromise.resolve(this.state.payloadEnvelope);
    } else {
      // No payload yet, all columns ready
      this.state = {
        hasPayload: false,
        hasAllColumns: true,
      };
    }
  }

  // --- Other getters ---

  getVersionedHashes(): VersionedHashes {
    return this.versionedHashes;
  }

  hasPayloadEnvelope(): boolean {
    return this.state.hasPayload;
  }

  getPayloadEnvelope(): gloas.SignedExecutionPayloadEnvelope {
    if (!this.state.hasPayload) throw new Error("Payload envelope not set");
    return this.state.payloadEnvelope;
  }

  getPayloadEnvelopeSource(): SourceMeta {
    if (!this.state.hasPayload) throw new Error("Payload envelope source not set");
    return this.state.payloadEnvelopeSource;
  }

  getSampledColumns(): gloas.DataColumnSidecars {
    return this.sampledColumns
      .filter((idx) => this.columnsCache.has(idx))
      .map((idx) => this.columnsCache.get(idx)!.columnSidecar);
  }

  getSampledColumnsWithSource(): ColumnWithSource[] {
    return this.sampledColumns.filter((idx) => this.columnsCache.has(idx)).map((idx) => this.columnsCache.get(idx)!);
  }

  getCustodyColumns(): gloas.DataColumnSidecars {
    return this.custodyColumns
      .filter((idx) => this.columnsCache.has(idx))
      .map((idx) => this.columnsCache.get(idx)!.columnSidecar);
  }

  getTimeCreated(): number {
    return this.timeCreatedSec;
  }

  getTimeComplete(): number {
    if (!this.state.hasPayload || !this.state.hasAllColumns) throw new Error("Not yet complete");
    return this.state.timeCompleteSec;
  }

  isComplete(): boolean {
    return this.state.hasPayload && this.state.hasAllColumns;
  }

  async waitForData(): Promise<gloas.SignedExecutionPayloadEnvelope> {
    return this.dataPromise.promise;
  }

  getLogMeta(): {
    slot: number;
    blockRoot: string;
    hasPayload: boolean;
    hasAllColumns: boolean;
    isComplete: boolean;
    columnsCount: number;
    sampledColumnsCount: number;
  } {
    return {
      slot: this.slot,
      blockRoot: this.blockRootHex,
      hasPayload: this.state.hasPayload,
      hasAllColumns: this.state.hasAllColumns,
      isComplete: this.isComplete(),
      columnsCount: this.columnsCache.size,
      sampledColumnsCount: this.sampledColumns.length,
    };
  }
}
