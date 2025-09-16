import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {Root, fulu, ssz} from "@lodestar/types";
import {fromAsync, toHex} from "@lodestar/utils";
import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {DataColumnSidecarRepository} from "../../../../../src/db/repositories/dataColumnSidecar.js";
import {getDataColumnSidecarsFromBlock} from "../../../../../src/util/dataColumns.js";
import {kzg} from "../../../../../src/util/kzg.js";
import {testLogger} from "../../../../utils/logger.js";
import {DataColumnSidecarArchiveRepository} from "../../../../../src/db/repositories/dataColumnSidecarArchive.js";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";

/* eslint-disable @typescript-eslint/naming-convention */
const config = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
});

describe("dataColumnSidecar repository", () => {
  const testDir = "./.tmp";
  let dataColumnRepo: DataColumnSidecarRepository;
  let db: LevelDbController;
  let allDataColumnSidecars: fulu.DataColumnSidecars;
  const blobKzgCommitmentsLen = 3;
  const dataColumn = ssz.fulu.DataColumnSidecar.defaultValue();
  const blockSlot = 11;
  dataColumn.signedBlockHeader.message.slot = blockSlot;

  beforeEach(async () => {
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    dataColumnRepo = new DataColumnSidecarRepository(config, db);

    const blob = ssz.deneb.Blob.defaultValue();
    const commitment = kzg.blobToKzgCommitment(blob);
    const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    const blobs = [blob, blob, blob];
    const commitments = Array.from({length: blobKzgCommitmentsLen}, () => commitment);
    signedBlock.message.body.blobKzgCommitments = commitments;
    const cellsAndProofs = blobs.map((b) => kzg.computeCellsAndKzgProofs(b));
    allDataColumnSidecars = getDataColumnSidecarsFromBlock(config, signedBlock, cellsAndProofs);
    for (let j = 0; j < allDataColumnSidecars.length; j++) {
      allDataColumnSidecars[j].index = j;
    }
  });

  afterEach(async () => {
    await db.close();
    rimraf.sync(testDir);
  });

  describe("encodeKeyRaw", () => {
    const root = Buffer.from("0102030405060708010203040506070801020304050607080102030405060708", "hex");
    const columnIndex = 9;

    it("should correctly encode the key in right size", () => {
      const bytes = dataColumnRepo.encodeKeyRaw(root, columnIndex);

      // 32 byte root and 2 byte column index
      expect(bytes).toHaveLength(32 + 2);
    });

    it("should use correct byte size for slot", () => {
      const bytes = dataColumnRepo.encodeKeyRaw(root, columnIndex);

      // encoded as `be` 8 bytes value
      expect(bytes.slice(0, 32)).toEqual(
        Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8])
      );
    });

    it("should use correct byte size for column index", () => {
      const bytes = dataColumnRepo.encodeKeyRaw(root, columnIndex);

      // encoded as `be` 2 bytes value
      expect(bytes.slice(32)).toEqual(Buffer.from([0, 9]));
    });
  });

  describe("decodeKeyRaw", () => {
    const root = new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const columnIndex = 9;
    const bytes = new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 0, 9,
    ]);

    it("should correctly decode key", () => {
      expect(dataColumnRepo.decodeKeyRaw(bytes)).toEqual({prefix: root, id: columnIndex});
    });
  });

  describe("getMaxKeyRaw", () => {
    it("should return inclusive max key", () => {
      const root = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8,
      ]);

      const bytes = dataColumnRepo.getMaxKeyRaw(root);

      // We subtract 1 from total number of columns to have inclusive range
      expect(bytes.slice(32)).toEqual(Buffer.from([0, NUMBER_OF_COLUMNS - 1]));
    });
  });

  describe("getMinKeyRaw", () => {
    it("should return inclusive max key", () => {
      const root = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8,
      ]);

      const bytes = dataColumnRepo.getMinKeyRaw(root);

      // Columns starts from 0
      expect(bytes.slice(32)).toEqual(Buffer.from([0, 0]));
    });
  });
});

describe("dataColumnSidecarArchive repository", () => {
  const testDir = "./.tmp";
  let dataColumnRepo: DataColumnSidecarRepository;
  let dataColumnArchiveRepo: DataColumnSidecarArchiveRepository;
  let db: LevelDbController;
  let blockRoot: Root;
  let allDataColumnSidecars: fulu.DataColumnSidecars;
  const blobKzgCommitmentsLen = 3;
  const dataColumn = ssz.fulu.DataColumnSidecar.defaultValue();
  const blockSlot = 11;
  dataColumn.signedBlockHeader.message.slot = blockSlot;

  beforeEach(async () => {
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    dataColumnRepo = new DataColumnSidecarRepository(config, db);
    dataColumnArchiveRepo = new DataColumnSidecarArchiveRepository(config, db);

    blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumn.signedBlockHeader.message);
    const blob = ssz.deneb.Blob.defaultValue();
    const commitment = kzg.blobToKzgCommitment(blob);
    const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    const blobs = [blob, blob, blob];
    const commitments = Array.from({length: blobKzgCommitmentsLen}, () => commitment);
    signedBlock.message.body.blobKzgCommitments = commitments;
    const cellsAndProofs = blobs.map((b) => kzg.computeCellsAndKzgProofs(b));
    allDataColumnSidecars = getDataColumnSidecarsFromBlock(config, signedBlock, cellsAndProofs);
    for (let j = 0; j < allDataColumnSidecars.length; j++) {
      allDataColumnSidecars[j].index = j;
    }
  });

  afterEach(async () => {
    await db.close();
    rimraf.sync(testDir);
  });

  describe("encodeKeyRaw", () => {
    const slot = 12;
    const columnIndex = 3;

    it("should correctly encode the key in right size", () => {
      const bytes = dataColumnArchiveRepo.encodeKeyRaw(slot, columnIndex);

      // 8 byte slot and 2 byte column index
      expect(bytes).toHaveLength(8 + 2);
    });

    it("should use correct byte size for slot", () => {
      const bytes = dataColumnArchiveRepo.encodeKeyRaw(slot, columnIndex);

      // encoded as `be` 8 bytes value
      expect(bytes.slice(0, 8)).toEqual(Buffer.from([0, 0, 0, 0, 0, 0, 0, 12]));
    });

    it("should use correct byte size for column index", () => {
      const bytes = dataColumnArchiveRepo.encodeKeyRaw(slot, columnIndex);

      // encoded as `be` 2 bytes value
      expect(bytes.slice(8)).toEqual(Buffer.from([0, 3]));
    });
  });

  describe("decodeKeyRaw", () => {
    const slot = 12;
    const columnIndex = 3;
    const bytes = Buffer.from([0, 0, 0, 0, 0, 0, 0, 12, 0, 3]);

    it("should correctly decode key", () => {
      expect(dataColumnArchiveRepo.decodeKeyRaw(bytes)).toEqual({prefix: slot, id: columnIndex});
    });
  });

  describe("getMaxKeyRaw", () => {
    it("should return inclusive max key", () => {
      const slot = 9;

      const bytes = dataColumnArchiveRepo.getMaxKeyRaw(slot);

      // We subtract 1 from total number of columns to have inclusive range
      expect(bytes.slice(8)).toEqual(Buffer.from([0, NUMBER_OF_COLUMNS - 1]));
    });
  });

  describe("getMinKeyRaw", () => {
    it("should return inclusive max key", () => {
      const slot = 9;

      const bytes = dataColumnArchiveRepo.getMinKeyRaw(slot);

      // Columns starts from 0
      expect(bytes.slice(8)).toEqual(Buffer.from([0, 0]));
    });
  });

  it("should get data column sidecars by parent root", async () => {
    const dataColumnSidecars = allDataColumnSidecars.slice(0, 7);
    const dataColumnsLen = dataColumnSidecars.length;

    await dataColumnRepo.putMany(blockRoot, dataColumnSidecars);
    const retrievedDataColumnSidecars = await fromAsync(dataColumnRepo.valuesStream(blockRoot));

    expect(retrievedDataColumnSidecars).toHaveLength(dataColumnsLen);
    expect(retrievedDataColumnSidecars.map((c) => c.index)).toEqual(dataColumnSidecars.map((c) => c.index));
  });

  it("should get data column sidecars by matching bytes", async () => {
    const columnsSize =
      ssz.fulu.DataColumnSidecar.minSize +
      blobKzgCommitmentsLen *
        (ssz.fulu.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize);

    const dataColumnSidecars = allDataColumnSidecars.slice(0, 7);
    const dataColumnsLen = dataColumnSidecars.length;

    await dataColumnRepo.putMany(blockRoot, dataColumnSidecars);
    const retrievedDataColumnSidecarBytes = await fromAsync(dataColumnRepo.valuesStreamBinary(blockRoot));

    expect(retrievedDataColumnSidecarBytes).toHaveLength(dataColumnsLen);

    for (let i = 0; i < dataColumnsLen; i++) {
      expect(retrievedDataColumnSidecarBytes[i].value.byteLength).toEqual(columnsSize);
      expect(toHex(retrievedDataColumnSidecarBytes[i].value)).toEqual(
        toHex(ssz.fulu.DataColumnSidecar.serialize(dataColumnSidecars[i]))
      );
    }
  });

  it("should migrate DataColumnSidecars to archived db", async () => {
    // same api to writeBlockInputToDb
    await dataColumnRepo.putMany(blockRoot, allDataColumnSidecars);
    // same api to migrateDataColumnSidecarsFromHotToColDb
    const dataColumnSidecarBytes = await fromAsync(dataColumnRepo.valuesStreamBinary(blockRoot));
    await dataColumnArchiveRepo.putManyBinary(
      blockSlot,
      dataColumnSidecarBytes.map((p) => ({key: p.id, value: p.value}))
    );
    // same api to onDataColumnSidecarsByRange when serving p2p requests
    const dataColumnSidecars = await dataColumnArchiveRepo.getManyBinary(
      blockSlot,
      allDataColumnSidecars.map((c) => c.index)
    );
    expect(dataColumnSidecars).toHaveLength(allDataColumnSidecars.length);
    for (const [i, serialized] of dataColumnSidecars.entries()) {
      expect(serialized).toBeDefined();
      if (serialized == null) {
        throw Error("Unexpected undefined dataColumnSidecar");
      }
      expect(toHex(serialized)).toEqual(toHex(ssz.fulu.DataColumnSidecar.serialize(allDataColumnSidecars[i])));
    }
  });
});
