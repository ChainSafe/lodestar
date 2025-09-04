import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {Root, fulu, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {DataColumnSidecarRepository} from "../../../../../src/db/repositories/dataColumnSidecar.js";
import {getDataColumnSidecarsFromBlock} from "../../../../../src/util/dataColumns.js";
import {kzg} from "../../../../../src/util/kzg.js";
import {testLogger} from "../../../../utils/logger.js";
import {DataColumnSidecarArchiveRepository} from "../../../../../src/db/repositories/dataColumnSidecarArchive.js";

/* eslint-disable @typescript-eslint/naming-convention */
const config = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
});
describe("block archive repository", () => {
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

  it("should get data column sidecars by parent root", async () => {
    const dataColumnSidecars = allDataColumnSidecars.slice(0, 7);
    const dataColumnsLen = dataColumnSidecars.length;

    await dataColumnRepo.putMany(blockRoot, dataColumnSidecars);
    const retrievedDataColumnSidecars = await dataColumnRepo.values(blockRoot);

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
    const retrievedDataColumnSidecarBytes = await dataColumnRepo.valuesBinary(blockRoot);

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
    const dataColumnSidecarBytes = await dataColumnRepo.valuesBinary(blockRoot);
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
