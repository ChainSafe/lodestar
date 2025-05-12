import {ByteVectorType} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {fulu, ssz} from "@lodestar/types";
import {rimraf} from "rimraf";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {
  COLUMN_SIZE_IN_WRAPPER_INDEX,
  CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX,
  DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX,
  DataColumnSidecarsRepository,
  NUM_COLUMNS_IN_WRAPPER_INDEX,
  dataColumnSidecarsWrapperSsz,
} from "../../../../../src/db/repositories/dataColumnSidecars.js";
import {computeDataColumnSidecars} from "../../../../../src/util/blobs.js";
import {initCKZG, loadEthereumTrustedSetup} from "../../../../../src/util/kzg.js";
import {testLogger} from "../../../../utils/logger.js";

/* eslint-disable @typescript-eslint/naming-convention */
const config = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
});
describe("block archive repository", () => {
  const testDir = "./.tmp";
  let dataColumnRepo: DataColumnSidecarsRepository;
  let db: LevelDbController;

  beforeEach(async () => {
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    dataColumnRepo = new DataColumnSidecarsRepository(config, db);
  });
  afterEach(async () => {
    await db.close();
    rimraf.sync(testDir);
  });

  beforeAll(async () => {
    await initCKZG();
    loadEthereumTrustedSetup();
  });

  it("should get block by parent root", async () => {
    const dataColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumn.signedBlockHeader.message);
    const slot = dataColumn.signedBlockHeader.message.slot;
    const blob = ssz.deneb.Blob.defaultValue();
    const commitment = ssz.deneb.KZGCommitment.defaultValue();
    const kzgProof = ssz.deneb.KZGProof.defaultValue();
    const singedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();

    singedBlock.message.body.blobKzgCommitments.push(commitment);
    singedBlock.message.body.blobKzgCommitments.push(commitment);
    singedBlock.message.body.blobKzgCommitments.push(commitment);
    const allDataColumnSidecars = computeDataColumnSidecars(config, singedBlock, {
      blobs: [blob, blob, blob],
      kzgProofs: Array.from({length: 3 * NUMBER_OF_COLUMNS}, () => kzgProof),
    });
    for (let j = 0; j < allDataColumnSidecars.length; j++) {
      allDataColumnSidecars[j].index = j;
    }

    const blobKzgCommitmentsLen = 3;
    const columnsSize =
      ssz.fulu.DataColumnSidecar.minSize +
      blobKzgCommitmentsLen *
        (ssz.fulu.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize);

    const dataColumnSidecars = allDataColumnSidecars.slice(0, 7);
    const dataColumnsLen = dataColumnSidecars.length;
    const dataColumnsIndex = Array.from({length: NUMBER_OF_COLUMNS}, (_v, _i) => 0);
    for (let i = 0; i < dataColumnsLen; i++) {
      dataColumnsIndex[i] = i + 1;
    }
    dataColumnsIndex[127] = 19;

    const writeData = {
      blockRoot,
      slot,
      dataColumnsLen,
      dataColumnsSize: columnsSize,
      dataColumnsIndex: Uint8Array.from(dataColumnsIndex),
      dataColumnSidecars,
    };

    await dataColumnRepo.add(writeData);
    const retrievedBinary = await dataColumnRepo.getBinary(blockRoot);
    if (!retrievedBinary) throw Error("get by root returned null");

    const retrieved = dataColumnSidecarsWrapperSsz.deserialize(retrievedBinary);
    expect(dataColumnSidecarsWrapperSsz.equals(retrieved, writeData)).toBe(true);

    const retrivedColumnsLen = ssz.Uint8.deserialize(
      retrievedBinary.slice(NUM_COLUMNS_IN_WRAPPER_INDEX, COLUMN_SIZE_IN_WRAPPER_INDEX)
    );
    expect(retrivedColumnsLen === dataColumnsLen).toBe(true);

    const retrievedColumnsSizeBytes = retrievedBinary.slice(
      COLUMN_SIZE_IN_WRAPPER_INDEX,
      CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX
    );

    const retrievedColumnsSize = ssz.UintNum64.deserialize(retrievedColumnsSizeBytes);
    expect(retrievedColumnsSize === columnsSize).toBe(true);
    const dataColumnSidecarsBytes = retrievedBinary.slice(
      DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX + 4 * retrivedColumnsLen
    );
    // console.log({dataColumnSidecarsBytes: dataColumnSidecarsBytes.length, computeLen: dataColumnSidecarsBytes.length/columnsSize, dataColumnsLen, dataColumnSidecars: dataColumnSidecars.length, retrievedColumnsSize, columnsSize, allDataColumnSidecars: allDataColumnSidecars.length, lastIndex, DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX, retrivedColumnsLen})
    expect(dataColumnSidecarsBytes.length === columnsSize * dataColumnsLen).toBe(true);

    for (let j = 0; j < dataColumnsLen; j++) {
      const dataColumnBytes = dataColumnSidecarsBytes.slice(j * columnsSize, (j + 1) * columnsSize);
      const retrivedDataColumnSidecar = ssz.fulu.DataColumnSidecar.deserialize(dataColumnBytes);
      const index = retrivedDataColumnSidecar.index;
      expect(j === index).toBe(true);
    }
  });
});
