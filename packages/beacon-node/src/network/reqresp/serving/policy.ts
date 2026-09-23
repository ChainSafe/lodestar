import {BeaconConfig} from "@lodestar/config";
import {DB_READ_LIMITS_V1, Db} from "@lodestar/db";
import {
  ForkName,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
  isForkPostAltair,
  isForkPostGloas,
} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {ServingConfigurationError, ServingLimits} from "../../../chain/serving/context.js";
import {blobSidecarsWrapperSsz} from "../../../db/repositories/blobSidecars.js";
import {NUM_WITNESS, NUM_WITNESS_ELECTRA} from "../../../db/repositories/lightclientSyncCommitteeWitness.js";
import * as protocols from "../protocols.js";
import {ReqRespMethod} from "../types.js";

const MiB = 1024 * 1024;
export type ServingOptions = {
  totalBytes?: number;
  /** Maximum simultaneous source operations, excluding quota and response-write waits. */
  maxTasks?: number;
  ancestrySteps?: number;
  transactionVisits?: number;
};
export type ServingPolicy = ServingLimits &
  Readonly<{
    totalBytes: number;
    maxTasks: number;
    capacity: number;
    wireBytes: number;
    wrapperBytes: number;
    columnBatchBytes: number;
    workingBytes: number;
    stateBytes: number;
    methods: Readonly<Partial<Record<ReqRespMethod, ServingWork>>>;
  }>;
export type ServingWork = Readonly<{limits: ServingLimits; retainedBytes: number; workingBytes: number}>;
function integer(value: number, name: string, zero = false): number {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw new ServingConfigurationError(`Invalid ${name}`);
  return value;
}

export function assertSupportedServingSlot(config: BeaconConfig, currentSlot: number): void {
  if (!Number.isSafeInteger(currentSlot)) throw new ServingConfigurationError("Invalid current serving slot");
  const fork = config.getForkName(currentSlot);
  if (isForkPostGloas(fork)) throw new ServingConfigurationError(`Unsupported serving fork ${fork}`);
}

export function resolveServingPolicy(
  config: BeaconConfig,
  db: Pick<Db, "boundedReadVersion">,
  nativeIncomingCapacity: number,
  currentSlot: number,
  options: ServingOptions = {}
): ServingPolicy {
  if (db.boundedReadVersion !== 1) throw new ServingConfigurationError("Actual bounded DB capability v1 required");
  integer(nativeIncomingCapacity, "native incoming capacity");
  assertSupportedServingSlot(config, currentSlot);
  const forks = config.forksAscendingEpochOrder;
  if (forks.length > Object.keys(ForkName).length || config.BLOB_SCHEDULE.length > DB_READ_LIMITS_V1.maxIteratorRows)
    throw new ServingConfigurationError("Schedule cardinality");
  let previousEpoch = 0;
  for (const fork of forks) {
    if (fork.epoch !== Infinity) integer(fork.epoch * SLOTS_PER_EPOCH, "fork slot", true);
    if (fork.epoch < previousEpoch) throw new ServingConfigurationError("Unordered fork schedule");
    previousEpoch = fork.epoch;
  }
  let previousBpo = -1;
  let maxColumnsBlobs = 0;
  if (config.FULU_FORK_EPOCH !== Infinity)
    maxColumnsBlobs = integer(config.getMaxBlobsPerBlock(config.FULU_FORK_EPOCH), "Fulu blobs");
  for (const entry of config.BLOB_SCHEDULE) {
    integer(entry.EPOCH * SLOTS_PER_EPOCH, "BPO slot", true);
    integer(entry.MAX_BLOBS_PER_BLOCK, "BPO blobs");
    if (
      entry.EPOCH <= previousBpo ||
      entry.EPOCH < config.FULU_FORK_EPOCH ||
      entry.MAX_BLOBS_PER_BLOCK > MAX_BLOB_COMMITMENTS_PER_BLOCK
    )
      throw new ServingConfigurationError("Invalid BPO schedule");
    previousBpo = entry.EPOCH;
    maxColumnsBlobs = Math.max(maxColumnsBlobs, entry.MAX_BLOBS_PER_BLOCK);
  }
  if (maxColumnsBlobs > MAX_BLOB_COMMITMENTS_PER_BLOCK) throw new ServingConfigurationError("Fulu blobs exceed schema");
  let wireBytes = 0;
  let blockBytes = 0;
  let columnBytes = 0;
  let wrapperBytes = 0;
  let header = 0;
  let update = 0;
  const committee = ssz.altair.SyncCommittee.maxSize;
  let witness = 0;
  for (const fork of forks) {
    if (fork.epoch === Infinity || isForkPostGloas(fork.name)) continue;
    const blockProtocol = protocols.BeaconBlocksByRangeV2(fork.name, config);
    blockBytes = Math.max(blockBytes, integer(blockProtocol.responseSizes(fork.name).maxSize, "block response"));
    wireBytes = Math.max(wireBytes, blockBytes);
    if (fork.name === ForkName.deneb || fork.name === ForkName.electra) {
      const nextEpoch = forks[fork.seq + 1]?.epoch ?? Infinity;
      if (fork.epoch < nextEpoch) {
        const blobs = integer(config.getMaxBlobsPerBlock(fork.epoch), "pre-Fulu blobs");
        if (blobs > MAX_BLOB_COMMITMENTS_PER_BLOCK) throw new ServingConfigurationError("Blob list exceeds schema");
        wrapperBytes = Math.max(wrapperBytes, blobSidecarsWrapperSsz.minSize + ssz.deneb.BlobSidecar.maxSize * blobs);
      }
      wireBytes = Math.max(wireBytes, protocols.BlobSidecarsByRoot(fork.name, config).responseSizes(fork.name).maxSize);
    }
    if (fork.name === ForkName.fulu) {
      columnBytes = protocols.DataColumnSidecarsByRoot(fork.name, config).responseSizes(fork.name).maxSize;
      wireBytes = Math.max(wireBytes, columnBytes);
    }
    if (isForkPostAltair(fork.name)) {
      const types = sszTypesFor(fork.name);
      header = Math.max(header, types.LightClientHeader.maxSize);
      update = Math.max(update, 8 + types.LightClientUpdate.maxSize);
      witness = Math.max(
        witness,
        1 + 32 * (2 + (fork.seq >= config.forks.electra.seq ? NUM_WITNESS_ELECTRA : NUM_WITNESS))
      );
      for (const make of [
        protocols.LightClientBootstrap,
        protocols.LightClientUpdatesByRange,
        protocols.LightClientFinalityUpdate,
        protocols.LightClientOptimisticUpdate,
      ]) {
        wireBytes = Math.max(wireBytes, make(fork.name, config).responseSizes(fork.name).maxSize);
      }
    }
  }
  const columnType = ssz.fulu.DataColumnSidecar;
  const columnElementBytes =
    columnType.fields.column.elementType.fixedSize +
    columnType.fields.kzgCommitments.elementType.fixedSize +
    columnType.fields.kzgProofs.elementType.fixedSize;
  const columnBatchBytes = integer(
    NUMBER_OF_COLUMNS * (columnType.minSize + columnElementBytes * maxColumnsBlobs),
    "column batch"
  );
  const witnessRoots = Math.max(NUM_WITNESS, NUM_WITNESS_ELECTRA) + 2;
  const committeeOwners = SYNC_COMMITTEE_SIZE + 3;
  const headerOwners = 3 + 2 + 10 + 1 + 4 + 1;
  const bootstrapOwners = witnessRoots + 2 + 2 * committeeOwners + headerOwners + witnessRoots + 2;
  const updateOwners = 2 * headerOwners + committeeOwners + (NUM_WITNESS_ELECTRA + 2) * 2 + 6;
  const lightClient = Object.freeze({
    witness,
    committee,
    header,
    update,
    decodedBytes: Math.max(witness + 2 * committee + header + (NUM_WITNESS_ELECTRA + 1) * 32, 2 * update),
    metadata: Math.max(bootstrapOwners, 2 * updateOwners),
  });
  const decodedBytes = 128 * 1024;
  const blockRoots = integer(
    Math.max(config.MAX_REQUEST_BLOCKS, config.MAX_REQUEST_BLOCKS_DENEB),
    "request block roots"
  );
  const blobIdentifiers = integer(
    Math.max(config.MAX_REQUEST_BLOB_SIDECARS, config.MAX_REQUEST_BLOB_SIDECARS_ELECTRA),
    "request blob identifiers"
  );
  const columnRoots = integer(config.MAX_REQUEST_BLOCKS_DENEB, "request column roots");
  const requestDecodedBytes = integer(32 * Math.max(blockRoots, blobIdentifiers, columnRoots), "request decoded bytes");
  const requestMetadata = integer(
    Math.max(blockRoots + 1, 2 * blobIdentifiers + 1, 3 * columnRoots + 1),
    "request metadata"
  );
  const requestScalars = integer(Math.max(blobIdentifiers, columnRoots * NUMBER_OF_COLUMNS), "request scalars");
  if (Math.max(lightClient.decodedBytes + 32, requestDecodedBytes) > decodedBytes)
    throw new ServingConfigurationError("Decoded serving allowance");
  const sourceBytes = integer(
    Math.ceil(Math.max(wireBytes, wrapperBytes, witness + 2 * committee + header, update, columnBatchBytes) / MiB) *
      MiB,
    "source cap"
  );
  const maxRange = integer(Math.max(config.MAX_REQUEST_BLOCKS, config.MAX_REQUEST_BLOCKS_DENEB), "block range");
  if (
    sourceBytes > DB_READ_LIMITS_V1.maxValueBytes ||
    sourceBytes > DB_READ_LIMITS_V1.maxTotalBytes ||
    NUMBER_OF_COLUMNS > DB_READ_LIMITS_V1.maxEntries ||
    maxRange > DB_READ_LIMITS_V1.maxIteratorRows
  )
    throw new ServingConfigurationError("Serving policy exceeds native DB v1 limits");
  const totalBytes = integer(options.totalBytes ?? 256 * MiB, "total bytes");
  const maxTasks = integer(options.maxTasks ?? 6, "tasks");
  const transactionVisits = integer(
    options.transactionVisits ?? Math.min(MAX_TRANSACTIONS_PER_PAYLOAD, 65536),
    "transaction visits"
  );
  if (transactionVisits > MAX_TRANSACTIONS_PER_PAYLOAD)
    throw new ServingConfigurationError("Transaction work exceeds schema");
  const limits: ServingLimits = {
    sourceBytes,
    decodedBytes,
    requestDecodedBytes,
    requestMetadata,
    requestScalars,
    ancestrySteps: integer(options.ancestrySteps ?? Math.max(256 * SLOTS_PER_EPOCH, maxRange), "ancestry steps"),
    transactionVisits,
    blockBytes,
    columnBytes,
    maxEntries: NUMBER_OF_COLUMNS,
    maxIteratorRows: maxRange,
    lightClient,
  };
  const work = (bytes: number, retainedSources = 1): ServingWork => {
    const source = Math.max(1, Math.ceil(bytes / MiB)) * MiB;
    return {
      limits: {...limits, sourceBytes: source},
      retainedBytes: retainedSources * source,
      // A production step can hold native read output, its JS copy, and serialized replacement bytes.
      workingBytes: 3 * source,
    };
  };
  const blocks = work(blockBytes);
  const columns = work(Math.max(blockBytes, columnBatchBytes));
  // The range generator retains the wrapper, copied sidecar list and yielded sidecar across a write.
  const blobs = work(wrapperBytes, 3);
  const light = work(Math.max(witness + 2 * committee + header, update));
  const methods = {
    [ReqRespMethod.BeaconBlocksByRoot]: blocks,
    [ReqRespMethod.BeaconBlocksByRange]: blocks,
    [ReqRespMethod.BeaconBlocksByHead]: blocks,
    [ReqRespMethod.BlobSidecarsByRoot]: blobs,
    [ReqRespMethod.BlobSidecarsByRange]: blobs,
    [ReqRespMethod.DataColumnSidecarsByRoot]: columns,
    [ReqRespMethod.DataColumnSidecarsByRange]: columns,
    [ReqRespMethod.LightClientBootstrap]: light,
    [ReqRespMethod.LightClientUpdatesByRange]: light,
    [ReqRespMethod.LightClientFinalityUpdate]: light,
    [ReqRespMethod.LightClientOptimisticUpdate]: light,
  };
  const workingBytes = Math.max(...Object.values(methods).map((entry) => entry.workingBytes));
  const largestRetained = Math.max(...Object.values(methods).map((entry) => entry.retainedBytes));
  const requestBytes = Math.max(32 * blockRoots, 40 * blobIdentifiers, 40 * columnRoots + 8 * requestScalars);
  const stateBytes = decodedBytes + requestBytes;
  const capacity = Math.min(
    nativeIncomingCapacity,
    Math.floor((totalBytes - workingBytes - largestRetained) / stateBytes)
  );
  if (capacity < 1) throw new ServingConfigurationError("No maximum serving task fits");
  return Object.freeze({
    ...limits,
    totalBytes,
    maxTasks,
    capacity,
    wireBytes,
    wrapperBytes,
    columnBatchBytes,
    workingBytes,
    stateBytes,
    methods,
  });
}
