import {ColumnIndex, DataColumnSidecars, RootHex, Slot, ValidatorIndex, deneb, gloas} from "@lodestar/types";
import {toRootHex, withTimeout} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {AddPayloadEnvelopeProps, ColumnWithSource, CreateFromBlockProps, SourceMeta} from "./types.js";

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

  /** Guard against double import - only one caller can claim the import */
  private importClaimed = false;

  private timeCreatedSec: number;

  private readonly payloadEnvelopeDataPromise: PromiseParts<gloas.SignedExecutionPayloadEnvelope>;
  private readonly columnsDataPromise: PromiseParts<DataColumnSidecars>;

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
    const hasAllColumns = noBlobs || noSampledColumns;

    if (hasAllColumns) {
      this.state = {hasPayload: false, hasAllColumns: true};
      this.columnsDataPromise.resolve(this.getSampledColumns());
    } else {
      this.state = {hasPayload: false, hasAllColumns: false};
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
      throw new Error("Payload envelope already set");
    }
    if (toRootHex(props.envelope.message.beaconBlockRoot) !== this.blockRootHex) {
      throw new Error("Payload envelope beacon_block_root mismatch");
    }

    const source: SourceMeta = {
      source: props.source,
      seenTimestampSec: props.seenTimestampSec,
      peerIdStr: props.peerIdStr,
    };

    if (this.state.hasAllColumns) {
      // Complete state
      this.state = {
        hasPayload: true,
        hasAllColumns: true,
        payloadEnvelope: props.envelope,
        payloadEnvelopeSource: source,
        timeCompleteSec: props.seenTimestampSec,
      };
      this.payloadEnvelopeDataPromise.resolve(props.envelope);
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

    const hasAllSampledColumns = this.sampledColumns.every((idx) => this.columnsCache.has(idx));
    const noBlobs = this.bid.blobKzgCommitments.length === 0;
    const hasAllColumns = hasAllSampledColumns || noBlobs || this.sampledColumns.length === 0;

    if (!hasAllColumns) {
      return;
    }

    // All sampled columns received - resolve columns promise
    this.columnsDataPromise.resolve(this.getSampledColumns());

    if (this.state.hasPayload) {
      // Complete state
      this.state = {
        hasPayload: true,
        hasAllColumns: true,
        payloadEnvelope: this.state.payloadEnvelope,
        payloadEnvelopeSource: this.state.payloadEnvelopeSource,
        timeCompleteSec: seenTimestampSec,
      };
      this.payloadEnvelopeDataPromise.resolve(this.state.payloadEnvelope);
    } else {
      // No payload yet, all columns ready
      this.state = {
        hasPayload: false,
        hasAllColumns: true,
      };
    }
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

  getSampledColumns(): gloas.DataColumnSidecars {
    return this.sampledColumns
      .filter((idx) => this.columnsCache.has(idx))
      .map((idx) => this.columnsCache.get(idx)?.columnSidecar)
      .filter((col): col is gloas.DataColumnSidecar => col !== undefined);
  }

  getSampledColumnsWithSource(): ColumnWithSource[] {
    return this.sampledColumns
      .filter((idx) => this.columnsCache.has(idx))
      .map((idx) => this.columnsCache.get(idx))
      .filter((col): col is ColumnWithSource => col !== undefined);
  }

  getCustodyColumns(): gloas.DataColumnSidecars {
    return this.custodyColumns
      .filter((idx) => this.columnsCache.has(idx))
      .map((idx) => this.columnsCache.get(idx)?.columnSidecar)
      .filter((col): col is gloas.DataColumnSidecar => col !== undefined);
  }

  hasComputedAllData(): boolean {
    return this.state.hasAllColumns;
  }

  waitForComputedAllData(timeout: number, signal?: AbortSignal): Promise<DataColumnSidecars> {
    if (this.state.hasAllColumns) {
      return Promise.resolve(this.getSampledColumns());
    }
    return withTimeout(() => this.columnsDataPromise.promise, timeout, signal);
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

  /**
   * Check if this caller should import the payload.
   * Returns true only once - guards against race condition where multiple
   * gossip handlers (envelope + columns from different peers) could each
   * observe isComplete() === true and trigger concurrent imports.
   */
  shouldImport(): boolean {
    if (this.isComplete() && !this.importClaimed) {
      this.importClaimed = true;
      return true;
    }
    return false;
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
