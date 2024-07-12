import {rimraf} from "rimraf";
import {describe, it, expect, beforeEach, afterEach, beforeAll} from "vitest";
import {ByteVectorType} from "@chainsafe/ssz";
import {ssz, peerdas} from "@lodestar/types";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";

import {
  DataColumnSidecarsRepository,
  dataColumnSidecarsWrapperSsz,
  DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX,
  COLUMN_SIZE_IN_WRAPPER_INDEX,
  CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX,
} from "../../../../../src/db/repositories/dataColumnSidecars.js";
import {testLogger} from "../../../../utils/logger.js";
import {getDataColumnSidecars} from "../../../../../src/util/blobs.js";
import {loadEthereumTrustedSetup, initCKZG} from "../../../../../src/util/kzg.js";

/* eslint-disable @typescript-eslint/naming-convention */
const config = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  PEERDAS_FORK_EPOCH: 0,
});
describe("block archive repository", function () {
  const testDir = "./.tmp";
  let dataColumnRepo: DataColumnSidecarsRepository;
  let db: LevelDbController;

  beforeEach(async function () {
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    dataColumnRepo = new DataColumnSidecarsRepository(config, db);
  });
  afterEach(async function () {
    await db.close();
    rimraf.sync(testDir);
  });

  beforeAll(async function () {
    await initCKZG();
    loadEthereumTrustedSetup();
  });

  it("should get block by parent root", async function () {
    const dataColumn = ssz.peerdas.DataColumnSidecar.defaultValue();
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumn.signedBlockHeader.message);
    const slot = dataColumn.signedBlockHeader.message.slot;
    const blob = ssz.deneb.Blob.defaultValue();
    const commitment = ssz.deneb.KZGCommitment.defaultValue();
    const singedBlock = ssz.peerdas.SignedBeaconBlock.defaultValue();

    singedBlock.message.body.blobKzgCommitments.push(commitment);
    singedBlock.message.body.blobKzgCommitments.push(commitment);
    singedBlock.message.body.blobKzgCommitments.push(commitment);
    const dataColumnSidecars = getDataColumnSidecars(config, singedBlock, {
      blobs: [blob, blob, blob],
      kzgProofs: [commitment, commitment, commitment],
    });
    for (let j = 0; j < dataColumnSidecars.length; j++) {
      dataColumnSidecars[j].index = j;
    }

    const blobKzgCommitmentsLen = 3;
    const columnsSize =
      ssz.peerdas.DataColumnSidecar.minSize +
      blobKzgCommitmentsLen *
        (ssz.peerdas.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize);

    const numColumns = NUMBER_OF_COLUMNS;
    const blobsLen = (singedBlock.message as peerdas.BeaconBlock).body.blobKzgCommitments.length;

    // const dataColumnsSize = ssz.peerdas.DataColumnSidecar.minSize + blobsLen * (ssz.peerdas.Cell.fixedSize + ssz.deneb.KZGCommitment.fixedSize + ssz.deneb.KZGProof.fixedSize);

    // const dataColumnsLen = blockInput.blockData;
    const writeData = {
      blockRoot,
      slot,
      blobsLen,
      columnsSize,
      dataColumnsIndex: new ByteVectorType(NUMBER_OF_COLUMNS),
      dataColumnSidecars: ssz.peerdas.DataColumnSidecars,
    };

    await dataColumnRepo.add(writeData);
    const retrievedBinary = await dataColumnRepo.getBinary(blockRoot);
    if (!retrievedBinary) throw Error("get by root returned null");

    const retrieved = dataColumnSidecarsWrapperSsz.deserialize(retrievedBinary);
    expect(dataColumnSidecarsWrapperSsz.equals(retrieved, writeData)).toBe(true);

    const retrievedColumnsSizeBytes = retrievedBinary.slice(
      COLUMN_SIZE_IN_WRAPPER_INDEX,
      CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX
    );

    const retrievedColumnsSize = ssz.UintNum64.deserialize(retrievedColumnsSizeBytes);
    expect(retrievedColumnsSize === columnsSize).toBe(true);
    const dataColumnSidecarsBytes = retrievedBinary.slice(DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX);
    expect(dataColumnSidecarsBytes.length === columnsSize * numColumns).toBe(true);

    for (let j = 0; j < numColumns; j++) {
      const dataColumnBytes = dataColumnSidecarsBytes.slice(j * columnsSize, (j + 1) * columnsSize);
      const retrivedDataColumnSidecar = ssz.peerdas.DataColumnSidecar.deserialize(dataColumnBytes);
      const index = retrivedDataColumnSidecar.index;
      expect(j === index).toBe(true);
    }
  });
});
