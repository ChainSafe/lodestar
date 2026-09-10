import assert from "node:assert/strict";
import {createCipheriv} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PeerId} from "@libp2p/interface";
import {afterAll, beforeAll, bench, describe} from "@chainsafe/benchmark";
import {hasher, setHasher} from "@chainsafe/persistent-merkle-tree";
import {hasher as hashtreeHasher} from "@chainsafe/persistent-merkle-tree/hasher/hashtree";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {PayloadStatus} from "@lodestar/fork-choice";
import {BYTES_PER_CELL, ForkSeq, NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {
  onDataColumnSidecarsByRange,
  validateDataColumnSidecarsByRangeRequest,
} from "../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";
import {
  handleColumnSidecarUnavailability,
  validateRequestedDataColumns,
} from "../../../../src/network/reqresp/utils/dataColumnResponseValidation.js";
import {prettyPrintPeerId} from "../../../../src/network/util.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

/**
 * Complete successful Fulu handler reads, excluding network framing and consensus validation.
 * Uses real LevelDB repositories, archived block decoding/hashing, and flat-file I/O.
 * Fixtures have eight blobs and 256 KiB of deterministic transaction bytes per block.
 * Databases are reopened after seeding; measurements use warm LevelDB and OS caches.
 * Uses the hashtree hasher configured by the production CLI.
 * The baseline copies the finalized branch at baselineCommit and shares unchanged request validation.
 * Run from the repository root:
 * pnpm benchmark:files packages/beacon-node/test/perf/network/reqresp/dataColumnSidecarsByRange.test.ts
 */
const baselineCommit = "e25eb75f31210433e914ab09d98a6710c1565e44";
const startSlot = 1024;
const slotCount = 8;
const blobsPerBlock = 8;
const custodyColumns = Array.from({length: NUMBER_OF_COLUMNS}, (_, index) => index);
const config = createChainForkConfig({DENEB_FORK_EPOCH: 0, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: Infinity});
const logger: Logger = {error() {}, warn() {}, info() {}, verbose() {}, debug() {}};
const peerId = {toString: () => "benchmark-peer"} as PeerId;

describe("finalized data column range / warm cache", () => {
  let tmpDir: string;
  let db: BeaconDb;
  let chain: BeaconChain;
  let previousHasher = hasher;
  const expectedColumns = new Map<number, Uint8Array[]>();

  async function openDb(): Promise<BeaconDb> {
    const controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    const openedDb = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "columns"), logger});
    await openedDb.init();
    return openedDb;
  }

  beforeAll(async () => {
    previousHasher = hasher;
    setHasher(hashtreeHasher);
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lodestar-column-range-bench-"));
    db = await openDb();
    for (let slot = startSlot; slot < startSlot + slotCount; slot++) {
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.body.executionPayload.transactions = Array.from({length: 256}, (_, index) =>
        deterministicBytes(1024, slot, index)
      );
      block.message.body.blobKzgCommitments = Array.from({length: blobsPerBlock}, (_, index) =>
        deterministicBytes(48, slot, 256 + index)
      );
      const blockRoot = toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
      const bodyRoot = ssz.fulu.BeaconBlockBody.hashTreeRoot(block.message.body);
      const columns = custodyColumns.map((index) => {
        const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
        sidecar.index = index;
        sidecar.column = Array.from({length: blobsPerBlock}, (_, blob) =>
          deterministicBytes(BYTES_PER_CELL, slot, 512 + index * blobsPerBlock + blob)
        );
        sidecar.kzgCommitments = block.message.body.blobKzgCommitments;
        sidecar.kzgProofs = Array.from({length: blobsPerBlock}, (_, blob) =>
          deterministicBytes(48, slot, 2048 + index * blobsPerBlock + blob)
        );
        sidecar.signedBlockHeader.message = {
          slot,
          proposerIndex: block.message.proposerIndex,
          parentRoot: block.message.parentRoot,
          stateRoot: block.message.stateRoot,
          bodyRoot,
        };
        return ssz.fulu.DataColumnSidecar.serialize(sidecar);
      });
      expectedColumns.set(slot, columns);
      await db.blockArchive.put(slot, block);
      await db.dataColumnSidecarArchive.putManyBinary(
        slot,
        columns.map((value, key) => ({key, value}))
      );
      await db.dataColumns.putManyBinary(
        {slot, blockRoot},
        columns.map((data, index) => ({index, data}))
      );
    }
    await db.close();
    db = await openDb();

    const finalizedSlot = startSlot + slotCount + SLOTS_PER_EPOCH;
    const headChain = Array.from({length: 65}, (_, index) =>
      generateProtoBlock({slot: finalizedSlot + 64 - index, payloadStatus: PayloadStatus.FULL})
    );
    chain = {
      config,
      db,
      logger,
      metrics: null,
      clock: {currentEpoch: Math.ceil(headChain[0].slot / SLOTS_PER_EPOCH)},
      earliestAvailableSlot: 0,
      custodyConfig: {custodyColumns, custodyColumnsIndex: new Uint8Array(NUMBER_OF_COLUMNS).fill(1)},
      forkChoice: {
        getFinalizedBlock: () => headChain[64],
        getHead: () => headChain[0],
        getAllAncestorBlocks: () => headChain,
      },
      seenBlockInputCache: {get: () => undefined},
      seenPayloadEnvelopeInputCache: {get: () => undefined},
      serializedCache: new WeakMap(),
    } as unknown as BeaconChain;
    chain.getCanonicalBlockAtSlot = BeaconChain.prototype.getCanonicalBlockAtSlot.bind(chain);
    chain.getSerializedDataColumnSidecars = BeaconChain.prototype.getSerializedDataColumnSidecars.bind(chain);

    for (const count of [1, slotCount]) {
      for (const columns of [1, 8, NUMBER_OF_COLUMNS]) {
        const request = {startSlot, count, columns: custodyColumns.slice(0, columns)};
        for (const handler of [legacyFinalizedRange, onDataColumnSidecarsByRange]) {
          let position = 0;
          for await (const response of handler(request, chain, db, peerId, "benchmark")) {
            const slot = startSlot + Math.floor(position / columns);
            const expected = expectedColumns.get(slot)?.[request.columns[position % columns]];
            assert(expected, `unexpected response ${position} for slot ${slot}`);
            assert.deepEqual(Buffer.from(response.data), Buffer.from(expected), `wrong response ${position}`);
            position++;
          }
          assert.equal(position, count * columns);
        }
      }
    }
    console.log(`Baseline ${baselineCommit}; ${process.version}; ${os.cpus()[0]?.model}; hasher=${hasher.name}`);
    console.log(
      `Fixture: ${slotCount} slots, 256 KiB transactions/block, ${blobsPerBlock} blobs, ${expectedColumns.get(startSlot)?.[0].length} bytes/column`
    );
  }, 120_000);

  afterAll(async () => {
    try {
      await db?.close();
      if (tmpDir) await fs.rm(tmpDir, {recursive: true, force: true});
    } finally {
      setHasher(previousHasher);
    }
  });

  bench({
    id: "1 slot / archive block lookup, decode and hash",
    minRuns: 25,
    maxMs: 15_000,
    fn: async () => {
      const result = await chain.getCanonicalBlockAtSlot(startSlot);
      assert(result);
      config.getForkTypes(startSlot).BeaconBlock.hashTreeRoot(result.block.message);
    },
  });

  for (const count of [1, slotCount]) {
    for (const columns of [1, 8, NUMBER_OF_COLUMNS]) {
      const request: fulu.DataColumnSidecarsByRangeRequest = {
        startSlot,
        count,
        columns: custodyColumns.slice(0, columns),
      };
      for (const backend of ["legacy", "flat files"] as const) {
        bench({
          id: `${count} slots / ${columns} columns / ${backend}`,
          minRuns: 25,
          maxMs: 15_000,
          timeoutBench: 60_000,
          fn: async () => {
            const handler = backend === "legacy" ? legacyFinalizedRange : onDataColumnSidecarsByRange;
            await consume(handler(request, chain, db, peerId, "benchmark"));
          },
        });
      }
    }
  }
});

function deterministicBytes(length: number, slot: number, index: number): Uint8Array {
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(slot, 0);
  iv.writeUInt32LE(index, 4);
  return new Uint8Array(createCipheriv("aes-256-ctr", Buffer.alloc(32), iv).update(Buffer.alloc(length)));
}

async function consume(responses: AsyncIterable<ResponseOutgoing>): Promise<number> {
  let bytes = 0;
  for await (const response of responses) bytes += response.data.length;
  return bytes;
}

/** Successful finalized-range path from baselineCommit; non-finalized requests are outside this benchmark. */
async function* legacyFinalizedRange(
  request: fulu.DataColumnSidecarsByRangeRequest,
  chain: BeaconChain,
  db: BeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  const {
    startSlot,
    count,
    columns: requestedColumns,
  } = validateDataColumnSidecarsByRangeRequest(chain.config, chain.clock.currentEpoch, request);
  const availableColumns = validateRequestedDataColumns(chain, requestedColumns);
  const endSlot = startSlot + count;
  if (availableColumns.length === 0) return;

  if (endSlot - 1 < chain.earliestAvailableSlot) {
    chain.logger.verbose("Peer requested range before earliestAvailableSlot for DataColumnSidecarsByRange", {
      peer: prettyPrintPeerId(peerId),
      client: peerClient,
      startSlot,
      count,
      earliestAvailableSlot: chain.earliestAvailableSlot,
    });
    throw new ResponseError(
      RespStatus.RESOURCE_UNAVAILABLE,
      `Requested range is before earliestAvailableSlot startSlot=${startSlot} count=${count} earliestAvailableSlot=${chain.earliestAvailableSlot}`
    );
  }

  const finalized = db.dataColumnSidecarArchive;
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;
  const isPostGloasFinalized = chain.config.getForkSeq(finalizedSlot) >= ForkSeq.gloas;
  const archiveMaxSlot = isPostGloasFinalized ? finalizedSlot - 1 : finalizedSlot;
  assert(endSlot <= archiveMaxSlot, "legacy benchmark supports wholly archived requests only");

  if (startSlot <= archiveMaxSlot) {
    const archiveEnd = Math.min(endSlot, archiveMaxSlot + 1);
    for (let slot = startSlot; slot < archiveEnd; slot++) {
      const dataColumnSidecars = await finalized.getManyBinary(slot, availableColumns);
      const unavailableColumnIndices: number[] = [];
      for (let i = 0; i < dataColumnSidecars.length; i++) {
        const dataColumnSidecarBytes = dataColumnSidecars[i];
        if (dataColumnSidecarBytes) {
          yield {
            data: dataColumnSidecarBytes,
            boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
          };
        } else {
          unavailableColumnIndices.push(availableColumns[i]);
        }
      }
      if (unavailableColumnIndices.length) {
        await handleColumnSidecarUnavailability({
          chain,
          db,
          metrics: chain.metrics,
          unavailableColumnIndices,
          slot,
          requestedColumns,
          availableColumns,
          finalized: true,
        });
      }
    }
  }
}
