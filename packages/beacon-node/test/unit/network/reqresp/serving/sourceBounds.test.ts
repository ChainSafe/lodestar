import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {LevelDbController} from "@lodestar/db";
import {
  BLOB_SIDECAR_FIXED_SIZE,
  ForkName,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_EPOCH,
  isForkPostBellatrix,
} from "@lodestar/params";
import {LightClientHeader, LightClientUpdate, fulu, ssz, sszTypesFor} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../../../../../src/db/repositories/blobSidecars.js";
import {getRootIndex} from "../../../../../src/db/repositories/blockArchiveIndex.js";
import {GossipType} from "../../../../../src/network/gossip/interface.js";
import {getGossipSSZMaxSize} from "../../../../../src/network/gossip/topic.js";
import * as protocols from "../../../../../src/network/reqresp/protocols.js";
import {ServingWork, resolveServingPolicy} from "../../../../../src/network/reqresp/serving/policy.js";
import {ReqRespMethod} from "../../../../../src/network/reqresp/types.js";
import {servingConfig} from "../../../../utils/network/reqresp/servingCases.js";

/**
 * Pins the maximum legal stored values against the existing serving lease charges. Native read results coexist
 * with their JS copies during completion, including the whole getMany batch. Row-at-a-time cursors materialize one
 * row per page and release native page output after completion. The unchanged retained charges remain conservative.
 * Engine block buffers, decompression and block cache are outside the lease.
 */

const MAX_BLOBS = 21;
const config = servingConfig(MAX_BLOBS);
const policy = resolveServingPolicy(config, 6, 0);
const logger = {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn()} as unknown as Logger;
const root = new Uint8Array(32).fill(7);
/** Column bytes per blob: its cell, commitment and proof */
const COLUMN_BLOB_BYTES = ssz.fulu.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize;

function work(method: ReqRespMethod): ServingWork {
  const entry = policy.methods[method];
  if (!entry) throw Error(`No serving work for ${method}`);
  return entry;
}

function forkSlot(fork: ForkName): number {
  return config.forks[fork].epoch * SLOTS_PER_EPOCH;
}

/** Native `get` in a pull: the native value and its JS copy coexist in the completion callback */
function nativeGetPull(bytes: number): number {
  return 2 * bytes;
}

/** Native row-at-a-time completion: the copied native row and its JS copy coexist */
function nativeRangeRow(bytes: number): number {
  return 2 * bytes;
}

async function withDb(run: (db: BeaconDb, controller: LevelDbController) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "lodestar-source-bounds-"));
  const controller = await LevelDbController.create({name: path}, {logger});
  try {
    await run(new BeaconDb(config, controller), controller);
  } finally {
    await controller.close();
    await rm(path, {recursive: true, force: true});
  }
}

function maxColumn(blobs: number): fulu.DataColumnSidecar {
  const column = ssz.fulu.DataColumnSidecar.defaultValue();
  column.column = Array.from({length: blobs}, () => ssz.fulu.Cell.defaultValue());
  column.kzgCommitments = Array.from({length: blobs}, () => ssz.deneb.KZGCommitment.defaultValue());
  column.kzgProofs = Array.from({length: blobs}, () => ssz.deneb.KZGProof.defaultValue());
  return column;
}

function maxHeader(fork: ForkName): LightClientHeader {
  const header = sszTypesFor(fork as ForkName.altair).LightClientHeader.defaultValue() as LightClientHeader;
  header.beacon.slot = forkSlot(fork);
  if ("execution" in header) header.execution.extraData = new Uint8Array(32);
  return header;
}

function maxUpdate(fork: ForkName): LightClientUpdate {
  const update = sszTypesFor(fork as ForkName.altair).LightClientUpdate.defaultValue() as LightClientUpdate;
  update.attestedHeader = maxHeader(fork);
  update.finalizedHeader = maxHeader(fork);
  return update;
}

describe("serving source bounds with native reads", () => {
  it("stores the largest blob sidecar wrapper of each blob fork within the blob charges", async () => {
    const blobs = work(ReqRespMethod.BlobSidecarsByRange);
    expect(work(ReqRespMethod.BlobSidecarsByRoot)).toEqual(blobs);
    await withDb(async (db) => {
      for (const [fork, count] of [
        [ForkName.deneb, config.MAX_BLOBS_PER_BLOCK],
        [ForkName.electra, config.MAX_BLOBS_PER_BLOCK_ELECTRA],
      ] as const) {
        const slot = forkSlot(fork);
        const blobSidecars = Array.from({length: count}, () => ssz.deneb.BlobSidecar.defaultValue());
        // The only hot writer, after the state transition capped the block's commitments at the fork's blob limit
        await db.blobSidecars.add({blockRoot: root, slot, blobSidecars});
        const hot = await db.blobSidecars.getBinary(root);
        const expected = BLOB_SIDECARS_IN_WRAPPER_INDEX + count * BLOB_SIDECAR_FIXED_SIZE;
        expect(hot?.byteLength).toBe(expected);
        // Finalization migrates the hot bytes unchanged
        await db.blobSidecarsArchive.batchPutBinary([{key: slot, value: hot as Uint8Array}]);
        const archived = await db.blobSidecarsArchive.getBinary(slot);
        expect(archived?.byteLength).toBe(expected);
        const [entry] = await Array.fromAsync(db.blobSidecarsArchive.binaryEntriesStream({gte: slot, lt: slot + 1}));
        expect(entry.value.byteLength).toBe(expected);
        expect(expected).toBeLessThanOrEqual(policy.wrapperBytes);
      }
    });
    expect(policy.wrapperBytes).toBe(BLOB_SIDECARS_IN_WRAPPER_INDEX + 9 * BLOB_SIDECAR_FIXED_SIZE);
    // One blob more than the largest pre-Fulu limit would pass the charge the policy derives
    expect(BLOB_SIDECARS_IN_WRAPPER_INDEX + 10 * BLOB_SIDECAR_FIXED_SIZE).toBeGreaterThan(policy.wrapperBytes);
    // By root reads the wrapper with a get and holds its JS copy across the sidecar writes; by range holds the
    // archive stream's row
    expect(nativeGetPull(policy.wrapperBytes)).toBeLessThanOrEqual(blobs.workingBytes);
    expect(policy.wrapperBytes).toBeLessThanOrEqual(blobs.retainedBytes);
    expect(nativeRangeRow(policy.wrapperBytes)).toBeLessThanOrEqual(blobs.workingBytes);
    expect(nativeRangeRow(policy.wrapperBytes)).toBeLessThanOrEqual(blobs.retainedBytes);
  });

  it("stores the largest column batch of the blob schedule within the column charges", async () => {
    const columns = work(ReqRespMethod.DataColumnSidecarsByRoot);
    expect(work(ReqRespMethod.DataColumnSidecarsByRange)).toEqual(columns);
    const indices = Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i);
    const slot = forkSlot(ForkName.fulu);
    let batchBytes = 0;
    let largest = 0;
    await withDb(async (db) => {
      // The only hot writer persists custody columns whose length equals the imported block's commitments
      await db.dataColumnSidecar.putMany(
        root,
        indices.map((index) => Object.assign(maxColumn(MAX_BLOBS), {index}))
      );
      const hot = await db.dataColumnSidecar.getManyBinary(root, indices);
      for (const value of hot) {
        expect(value?.byteLength).toBe(ssz.fulu.DataColumnSidecar.minSize + MAX_BLOBS * COLUMN_BLOB_BYTES);
        batchBytes += value?.byteLength ?? 0;
        largest = Math.max(largest, value?.byteLength ?? 0);
      }
      // Finalization migrates the hot bytes unchanged
      await db.dataColumnSidecarArchive.putManyBinary(
        slot,
        hot.map((value, index) => ({key: index, value: value as Uint8Array}))
      );
      const archived = await db.dataColumnSidecarArchive.getManyBinary(slot, indices);
      expect(archived.reduce((sum, value) => sum + (value?.byteLength ?? 0), 0)).toBe(batchBytes);
    });
    expect(batchBytes).toBe(policy.columnBatchBytes);
    expect(largest).toBeLessThanOrEqual(policy.columnBytes);
    // Native completion holds the whole output batch while building its JS copies.
    expect(2 * batchBytes).toBeLessThanOrEqual(columns.workingBytes);
    expect(batchBytes).toBeLessThanOrEqual(columns.retainedBytes);
    // A missing column reads the block for its blob count while the batch is held
    expect(nativeGetPull(policy.blockBytes)).toBeLessThanOrEqual(columns.workingBytes);
    // A single column at the schema maximum fits the source, a batch of them would not: the batch bound rests on the
    // blob count guards of gossip, req/resp and the state transition, not on the schema
    expect(ssz.fulu.DataColumnSidecar.maxSize).toBe(
      ssz.fulu.DataColumnSidecar.minSize + MAX_BLOB_COMMITMENTS_PER_BLOCK * COLUMN_BLOB_BYTES
    );
    expect(ssz.fulu.DataColumnSidecar.maxSize).toBeLessThanOrEqual(columns.limits.sourceBytes);
    expect(NUMBER_OF_COLUMNS * ssz.fulu.DataColumnSidecar.maxSize).toBeGreaterThan(columns.limits.sourceBytes);
  });

  it("stores bounded light-client rows within the light-client charges", async () => {
    const light = work(ReqRespMethod.LightClientBootstrap);
    const {lightClient} = policy;
    await withDb(async (db) => {
      for (const witnesses of [4, 5]) {
        await db.syncCommitteeWitness.put(root, {
          witness: Array.from({length: witnesses}, () => new Uint8Array(32)),
          currentSyncCommitteeRoot: new Uint8Array(32),
          nextSyncCommitteeRoot: new Uint8Array(32),
        });
        const bytes = await db.syncCommitteeWitness.getBinary(root);
        expect(bytes?.byteLength).toBe(1 + 32 * (witnesses + 2));
        expect(bytes?.byteLength).toBeLessThanOrEqual(lightClient.witness);
      }
      // Rows written before the prefix byte carry four witnesses and two roots
      expect(32 * (4 + 2)).toBeLessThanOrEqual(lightClient.witness);

      await db.syncCommittee.putBinary(
        root,
        ssz.altair.SyncCommittee.serialize(ssz.altair.SyncCommittee.defaultValue())
      );
      expect((await db.syncCommittee.getBinary(root))?.byteLength).toBe(lightClient.committee);

      for (const fork of [ForkName.altair, ForkName.capella, ForkName.deneb, ForkName.electra, ForkName.fulu]) {
        const types = sszTypesFor(fork as ForkName.altair);
        await db.checkpointHeader.put(root, maxHeader(fork));
        const header = await db.checkpointHeader.getBinary(root);
        expect(header?.byteLength).toBe(types.LightClientHeader.maxSize);
        expect(header?.byteLength).toBeLessThanOrEqual(lightClient.header);

        await db.bestLightClientUpdate.put(1, maxUpdate(fork));
        const update = await db.bestLightClientUpdate.getBinary(1);
        expect(update?.byteLength).toBe(8 + types.LightClientUpdate.maxSize);
        expect(update?.byteLength).toBeLessThanOrEqual(lightClient.update);
      }
    });
    // Bootstrap reads the witness, both committees at once, then the header, and serializes the response in the pull
    const bootstrapReads = lightClient.witness + 2 * lightClient.committee + lightClient.header;
    const bootstrap = sszTypesFor(ForkName.fulu).LightClientBootstrap.maxSize;
    expect(bootstrapReads).toBeLessThanOrEqual(light.limits.sourceBytes);
    expect(nativeGetPull(bootstrapReads) + bootstrap).toBeLessThanOrEqual(light.workingBytes);
    expect(nativeGetPull(lightClient.update) + lightClient.update).toBeLessThanOrEqual(light.workingBytes);
    expect(Math.max(bootstrap, lightClient.update)).toBeLessThanOrEqual(light.retainedBytes);
  });

  it("stores eight-byte archive root index rows", async () => {
    await withDb(async (db, controller) => {
      const slot = forkSlot(ForkName.fulu);
      await db.blockArchive.batchPutBinary([
        {key: slot, value: new Uint8Array(8), slot, blockRoot: root, parentRoot: new Uint8Array(32)},
      ]);
      expect((await getRootIndex(controller, root))?.byteLength).toBe(8);
    });
  });

  it("bounds network-delivered and locally published blocks at the block charges, but not rows stored before", async () => {
    const blocks = work(ReqRespMethod.BeaconBlocksByRoot);
    const ranges = work(ReqRespMethod.BeaconBlocksByRange);
    expect(work(ReqRespMethod.BeaconBlocksByHead)).toEqual(blocks);
    expect(ranges.limits).toEqual(blocks.limits);
    expect(ranges.workingBytes).toBe(blocks.workingBytes);
    expect(policy.blockBytes).toBe(config.MAX_PAYLOAD_SIZE);
    expect(blocks.limits.sourceBytes).toBe(config.MAX_PAYLOAD_SIZE);
    for (const fork of [
      ForkName.phase0,
      ForkName.altair,
      ForkName.bellatrix,
      ForkName.capella,
      ForkName.deneb,
      ForkName.electra,
      ForkName.fulu,
    ]) {
      const schema = sszTypesFor(fork).SignedBeaconBlock.maxSize;
      // Req/resp decoding and gossip admission cap every network-delivered block
      const network = Math.min(schema, config.MAX_PAYLOAD_SIZE);
      for (const protocol of [protocols.BeaconBlocksByRangeV2, protocols.BeaconBlocksByRootV2]) {
        expect(protocol(fork, config).responseSizes(fork).maxSize).toBe(network);
      }
      const boundary = {fork, epoch: config.forks[fork].epoch};
      expect(getGossipSSZMaxSize({type: GossipType.beacon_block, boundary}, config.MAX_PAYLOAD_SIZE)).toBe(
        config.MAX_PAYLOAD_SIZE
      );
      // From Bellatrix the schema admits about 2^50 bytes of transactions, so it bounds nothing
      if (isForkPostBellatrix(fork)) expect(schema).toBeGreaterThan(2 ** 49);
    }
    // A block at the network cap fits both copies in the pull and the JS copy between pulls.
    expect(nativeGetPull(config.MAX_PAYLOAD_SIZE)).toBeLessThanOrEqual(blocks.workingBytes);
    expect(config.MAX_PAYLOAD_SIZE).toBeLessThanOrEqual(blocks.retainedBytes);
    // The existing retained allowance also covers both copies of the key and row metadata.
    expect(nativeRangeRow(config.MAX_PAYLOAD_SIZE)).toBeLessThanOrEqual(blocks.workingBytes);
    const rowMetadata = ranges.retainedBytes - nativeRangeRow(config.MAX_PAYLOAD_SIZE);
    expect(rowMetadata).toBeGreaterThanOrEqual(2 * 9 + 1024);
    expect(rowMetadata).toBeLessThan(64 * 1024);
    // Local publication now refuses blocks above the cap, but the repository keeps whatever a writer put before: a
    // repository read with the default native cap still accepts a row above the protocol bound.
    await withDb(async (db) => {
      await db.block.putBinary(root, new Uint8Array(blocks.limits.sourceBytes + 1));
      expect((await db.block.getBinary(root))?.byteLength).toBe(blocks.limits.sourceBytes + 1);
    });
  });
});
