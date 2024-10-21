/* eslint-disable @typescript-eslint/naming-convention */
import {describe, it, expect, beforeAll, afterEach} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {bigIntToBytes} from "@lodestar/utils";

import {getDataColumns, getCustodyConfig} from "../../../src/util/dataColumns.js";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {ckzg, initCKZG, loadEthereumTrustedSetup} from "../../../src/util/kzg.js";
import {generateRandomBlob, transactionForKzgCommitment} from "../../utils/kzg.js";
import {computeDataColumnSidecars} from "../../../src/util/blobs.js";
import {validateDataColumnsSidecars} from "../../../src/chain/validation/dataColumnSidecar.js";

describe("getCustodyConfig", () => {
  it("validateDataColumnsSidecars", () => {
    const config = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      PEERDAS_FORK_EPOCH: 0,
    });
    const nodeId = fromHexString("cdbee32dc3c50e9711d22be5565c7e44ff6108af663b2dc5abd2df573d2fa83f");
    const custodyConfig = getCustodyConfig(nodeId, config);
    const {custodyColumnsLen, custodyColumns, custodyColumnsIndex, sampledColumns} = custodyConfig;

    expect(custodyColumnsLen).toEqual(4);
    expect(custodyColumns).toEqual([2, 80, 89, 118]);
    expect(sampledColumns.length).toEqual(8);
    const custodyPresentInSample = custodyColumns.reduce((acc, elem) => acc && sampledColumns.includes(elem), true);
    expect(custodyPresentInSample).toEqual(true);
  });
});

describe("getDataColumns", () => {
  const testCases = [
    ["cdbee32dc3c50e9711d22be5565c7e44ff6108af663b2dc5abd2df573d2fa83f", 4, [2, 80, 89, 118]],
    [
      "51781405571328938149219259614021022118347017557305093857689627172914154745642",
      47,
      [
        3, 6, 7, 8, 9, 12, 25, 26, 29, 30, 32, 40, 42, 47, 52, 53, 54, 55, 56, 57, 69, 70, 71, 72, 74, 77, 80, 81, 83,
        88, 93, 94, 95, 98, 101, 105, 106, 112, 114, 116, 118, 120, 121, 123, 124, 125, 127,
      ],
    ],
    ["84065159290331321853352677657753050104170032838956724170714636178275273565505", 6, [27, 29, 58, 67, 96, 117]],
  ];
  for (const [nodeIdHex, numSubnets, custodyColumns] of testCases) {
    it(`${nodeIdHex} / ${numSubnets}`, async () => {
      const nodeId = nodeIdHex.length === 64 ? fromHexString(nodeIdHex) : bigIntToBytes(BigInt(nodeIdHex), 32, "be");

      const columnIndexs = getDataColumns(nodeId, numSubnets);
      expect(columnIndexs).toEqual(custodyColumns);
    });
  }
});
describe("data column sidecars", () => {
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  beforeAll(async function () {
    await initCKZG();
    loadEthereumTrustedSetup();
  });

  it("validateDataColumnsSidecars", () => {
    const chainConfig = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
    });
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    const chain = getMockedBeaconChain({config});
    afterEachCallbacks.push(() => chain.close());

    const slot = 0;
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const kzgCommitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));

    const signedBeaconBlock = ssz.deneb.SignedBeaconBlock.defaultValue();

    for (const kzgCommitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(kzgCommitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(kzgCommitment);
    }
    const blockRoot = ssz.deneb.BeaconBlock.hashTreeRoot(signedBeaconBlock.message);
    const columnSidecars = computeDataColumnSidecars(config, signedBeaconBlock, {
      blobs,
    });

    expect(columnSidecars.length).toEqual(NUMBER_OF_COLUMNS);
    expect(columnSidecars[0].column.length).toEqual(blobs.length);

    expect(validateDataColumnsSidecars(slot, blockRoot, kzgCommitments, columnSidecars)).toBeUndefined();
  });

  it("fail for no blob commitments in validateDataColumnsSidecars", () => {
    const chainConfig = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
    });
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    const chain = getMockedBeaconChain({config});
    afterEachCallbacks.push(() => chain.close());

    const slot = 0;
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const kzgCommitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));

    const signedBeaconBlock = ssz.deneb.SignedBeaconBlock.defaultValue();

    for (const kzgCommitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(kzgCommitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(kzgCommitment);
    }
    const blockRoot = ssz.deneb.BeaconBlock.hashTreeRoot(signedBeaconBlock.message);
    const columnSidecars = computeDataColumnSidecars(config, signedBeaconBlock, {
      blobs,
    });

    expect(columnSidecars.length).toEqual(NUMBER_OF_COLUMNS);
    expect(columnSidecars[0].column.length).toEqual(blobs.length);

    signedBeaconBlock.message.body.blobKzgCommitments.length = [];

    expect(() => validateDataColumnsSidecars(slot, blockRoot, kzgCommitments, columnSidecars)).toThrow(
      `Invalid data column sidecar slot=${slot}`
    );
  });
});
