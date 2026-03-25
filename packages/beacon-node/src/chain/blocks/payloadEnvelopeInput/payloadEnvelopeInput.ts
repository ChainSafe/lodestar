import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, RootHex, Slot, ValidatorIndex, deneb, gloas} from "@lodestar/types";
import {toRootHex, withTimeout} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {AddPayloadEnvelopeProps, ColumnWithSource, CreateFromBlockProps, SourceMeta} from "./types.js";

export type PayloadEnvelopeInputState =
  | {
      hasPayload: false;
      hasAllData: false;
      hasComputedAllData: false;
    }
  | {
      hasPayload: false;
      hasAllData: true;
      hasComputedAllData: boolean;
    }
  | {
      hasPayload: true;
      hasAllData: false;
      hasComputedAllData: false;
      payloadEnvelope: gloas.SignedExecutionPayloadEnvelope;
      payloadEnvelopeSource: SourceMeta;
    }
  | {
      hasPayload: true;
      hasAllData: true;
      hasComputedAllData: boolean;
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
 */
export class PayloadEnvelopeInput {
  readonly blockRootHex: RootHex;
  readonly slot: Slot;
  readonly proposerIndex: ValidatorIndex;
  readonly bid: gloas.ExecutionPayloadBid;
  readonly versionedHashes: VersionedHashes;

  private columnsCache = new Map<ColumnIndex, ColumnWithSource>();

  private readonly sampledColumns: ColumnIndex[];
  private readonly custodyColumns: ColumnIndex[];

  private timeCreatedSec: number;

  private readonly payloadEnvelopeDataPromise: PromiseParts<gloas.SignedExecutionPayloadEnvelope>;
  private readonly columnsDataPromise: PromiseParts<gloas.DataColumnSidecar[]>;

  state: PayloadEnvelopeInputState;

  private constructor(props: {
    blockRootHex: RootHex;
    slot: Slot;
    proposerIndex: ValidatorIndex;
    bid: gloas.ExecutionPayloadBid;
    sampledColumns: ColumnIndex[];
    custodyColumns: ColumnIndex[];
    timeCreatedSec: number;
  }) {
    this.blockRootHex = props.blockRootHex;
    this.slot = props.slot;
    this.proposerIndex = props.proposerIndex;
    this.bid = props.bid;
    this.versionedHashes = props.bid.blobKzgCommitments.map(kzgCommitmentToVersionedHash);
    this.sampledColumns = props.sampledColumns;
    this.custodyColumns = props.custodyColumns;
    this.timeCreatedSec = props.timeCreatedSec;
    this.payloadEnvelopeDataPromise = createPromise();
    this.columnsDataPromise = createPromise();

    const noBlobs = props.bid.blobKzgCommitments.length === 0;
    const noSampledColumns = props.sampledColumns.length === 0;
    const hasAllData = noBlobs || noSampledColumns;

    if (hasAllData) {
      this.state = {hasPayload: false, hasAllData: true, hasComputedAllData: true};
      this.columnsDataPromise.resolve(this.getSampledColumns());
    } else {
      this.state = {hasPayload: false, hasAllData: false, hasComputedAllData: false};
    }
  }

  static createFromBlock(props: CreateFromBlockProps): PayloadEnvelopeInput {
    const bid = (props.block.message.body as gloas.BeaconBlockBody).signedExecutionPayloadBid.message;
    return new PayloadEnvelopeInput({
      blockRootHex: props.blockRootHex,
      slot: props.block.message.slot,
      proposerIndex: props.block.message.proposerIndex,
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
      throw new Error(`Payload envelope already set for block ${this.blockRootHex}`);
    }
    if (toRootHex(props.envelope.message.beaconBlockRoot) !== this.blockRootHex) {
      throw new Error("Payload envelope beacon_block_root mismatch");
    }

    const source: SourceMeta = {
      source: props.source,
      seenTimestampSec: props.seenTimestampSec,
      peerIdStr: props.peerIdStr,
    };

    if (this.state.hasAllData) {
      // Complete state
      this.state = {
        hasPayload: true,
        hasAllData: true,
        hasComputedAllData: this.state.hasComputedAllData,
        payloadEnvelope: props.envelope,
        payloadEnvelopeSource: source,
        timeCompleteSec: props.seenTimestampSec,
      };
      this.payloadEnvelopeDataPromise.resolve(props.envelope);
    } else {
      // Has payload, waiting for columns
      this.state = {
        hasPayload: true,
        hasAllData: false,
        hasComputedAllData: false,
        payloadEnvelope: props.envelope,
        payloadEnvelopeSource: source,
      };
    }
  }

  addColumn(columnWithSource: ColumnWithSource): void {
    const {columnSidecar, seenTimestampSec} = columnWithSource;
    this.columnsCache.set(columnSidecar.index, columnWithSource);

    const sampledColumns = this.getSampledColumns();
    const hasAllData =
      // already hasAllData
      this.state.hasAllData ||
      // has all sampled columns
      sampledColumns.length === this.sampledColumns.length ||
      // has enough columns to reconstruct the rest
      this.columnsCache.size >= NUMBER_OF_COLUMNS / 2;

    const hasComputedAllData =
      // has all sampled columns
      sampledColumns.length === this.sampledColumns.length;

    if (!hasAllData) {
      return;
    }

    if (hasComputedAllData) {
      this.columnsDataPromise.resolve(sampledColumns);
    }

    if (this.state.hasPayload) {
      // Complete state
      this.state = {
        hasPayload: true,
        hasAllData: true,
        hasComputedAllData: hasComputedAllData || this.state.hasComputedAllData,
        payloadEnvelope: this.state.payloadEnvelope,
        payloadEnvelopeSource: this.state.payloadEnvelopeSource,
        timeCompleteSec: seenTimestampSec,
      };
      this.payloadEnvelopeDataPromise.resolve(this.state.payloadEnvelope);
    } else {
      // No payload yet, all data ready
      this.state = {
        hasPayload: false,
        hasAllData: true,
        hasComputedAllData: hasComputedAllData || this.state.hasComputedAllData,
      };
    }
  }

  hasColumn(index: ColumnIndex): boolean {
    return this.columnsCache.has(index);
  }

  getColumn(index: ColumnIndex): gloas.DataColumnSidecar | undefined {
    return this.columnsCache.get(index)?.columnSidecar;
  }

  getAllColumns(): gloas.DataColumnSidecar[] {
    return [...this.columnsCache.values()].map(({columnSidecar}) => columnSidecar);
  }

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

  getSampledColumns(): gloas.DataColumnSidecar[] {
    const columns: gloas.DataColumnSidecar[] = [];
    for (const index of this.sampledColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar);
      }
    }
    return columns;
  }

  getSampledColumnsWithSource(): ColumnWithSource[] {
    const columns: ColumnWithSource[] = [];
    for (const index of this.sampledColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column);
      }
    }
    return columns;
  }

  getCustodyColumns(): gloas.DataColumnSidecar[] {
    const columns: gloas.DataColumnSidecar[] = [];
    for (const index of this.custodyColumns) {
      const column = this.columnsCache.get(index);
      if (column) {
        columns.push(column.columnSidecar);
      }
    }
    return columns;
  }

  hasComputedAllData(): boolean {
    return this.state.hasComputedAllData;
  }

  waitForComputedAllData(timeout: number, signal?: AbortSignal): Promise<gloas.DataColumnSidecar[]> {
    if (this.state.hasComputedAllData) {
      return Promise.resolve(this.getSampledColumns());
    }
    return withTimeout(() => this.columnsDataPromise.promise, timeout, signal);
  }

  getTimeCreated(): number {
    return this.timeCreatedSec;
  }

  getTimeComplete(): number {
    if (!this.state.hasPayload || !this.state.hasAllData) throw new Error("Not yet complete");
    return this.state.timeCompleteSec;
  }

  isComplete(): boolean {
    return this.state.hasPayload && this.state.hasAllData;
  }

  async waitForData(): Promise<gloas.SignedExecutionPayloadEnvelope> {
    return this.payloadEnvelopeDataPromise.promise;
  }

  getSerializedCacheKeys(): object[] {
    const objects: object[] = [];

    if (this.state.hasPayload) {
      objects.push(this.state.payloadEnvelope);
    }

    for (const {columnSidecar} of this.columnsCache.values()) {
      objects.push(columnSidecar);
    }

    return objects;
  }

  getLogMeta(): {
    slot: number;
    blockRoot: string;
    hasPayload: boolean;
    hasAllData: boolean;
    hasComputedAllData: boolean;
    isComplete: boolean;
    columnsCount: number;
    sampledColumnsCount: number;
  } {
    return {
      slot: this.slot,
      blockRoot: this.blockRootHex,
      hasPayload: this.state.hasPayload,
      hasAllData: this.state.hasAllData,
      hasComputedAllData: this.state.hasComputedAllData,
      isComplete: this.isComplete(),
      columnsCount: this.columnsCache.size,
      sampledColumnsCount: this.sampledColumns.length,
    };
  }
}
