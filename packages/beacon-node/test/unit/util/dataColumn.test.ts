/* eslint-disable @typescript-eslint/naming-convention */
import {describe, it, expect, beforeAll, afterEach} from "vitest";
import {ssz} from "@lodestar/types";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {getCustodyColumns} from "../../../src/util/dataColumns.js";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {ckzg, initCKZG, loadEthereumTrustedSetup} from "../../../src/util/kzg.js";
import {generateRandomBlob, transactionForKzgCommitment} from "../../utils/kzg.js";
import {computeDataColumnSidecars} from "../../../src/util/blobs.js";
import {validateDataColumnsSidecars} from "../../../src/chain/validation/dataColumnSidecar.js";

describe("custody columns", () => {
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
  it("getCustodyColumnIndexes", async () => {
    const nodeId = ssz.UintBn256.serialize(
      BigInt("84065159290331321853352677657753050104170032838956724170714636178275273565505")
    );
    const columnIndexs = getCustodyColumns(nodeId, 1);
    expect(columnIndexs).toEqual([27, 59, 91, 123]);
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
});
