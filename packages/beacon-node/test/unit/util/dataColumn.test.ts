import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS, NUMBER_OF_CUSTODY_GROUPS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {bigIntToBytes, fromHex} from "@lodestar/utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {validateDataColumnsSidecars} from "../../../src/chain/validation/dataColumnSidecar.js";
import {computeDataColumnSidecars} from "../../../src/util/blobs.js";
import {CustodyConfig, getDataColumns, getValidatorsCustodyRequirement} from "../../../src/util/dataColumns.js";
import {kzg} from "../../../src/util/kzg.js";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {generateRandomBlob, transactionForKzgCommitment} from "../../utils/kzg.js";

describe("getValidatorsCustodyRequirement", () => {
  let config: ChainForkConfig;

  beforeEach(() => {
    config = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: Infinity,
      BALANCE_PER_ADDITIONAL_CUSTODY_GROUP: 32000000000, // 32 ETH per group
      VALIDATOR_CUSTODY_REQUIREMENT: 8,
      CUSTODY_REQUIREMENT: 4,
    });
  });

  it("should return minimum requirement when total balance is below the balance per additional custody group", () => {
    const effectiveBalances = [32000000000, 32000000000]; // 2 validators with 32 ETH each = 64 ETH total
    const result = getValidatorsCustodyRequirement(config, effectiveBalances);
    expect(result).toBe(config.VALIDATOR_CUSTODY_REQUIREMENT);
  });

  it("should calculate correct number of groups based on total balance", () => {
    // Create a state with 10 validators with 32 ETH each = 320 ETH total
    const effectiveBalances = Array.from({length: 10}, () => 32000000000);
    const result = getValidatorsCustodyRequirement(config, effectiveBalances);
    expect(result).toBe(10);
  });

  it("should cap at maximum number of custody groups", () => {
    // Create a state with enough validators to exceed max groups
    const effectiveBalances = Array.from({length: NUMBER_OF_CUSTODY_GROUPS + 1}, () => 32000000000);
    const result = getValidatorsCustodyRequirement(config, effectiveBalances);
    expect(result).toBe(NUMBER_OF_CUSTODY_GROUPS);
  });

  it("should handle zero validators", () => {
    const effectiveBalances: number[] = [];
    const result = getValidatorsCustodyRequirement(config, effectiveBalances);
    expect(result).toBe(config.CUSTODY_REQUIREMENT);
  });
});

describe("CustodyConfig", () => {
  let config: ChainForkConfig;
  const nodeId = fromHex("cdbee32dc3c50e9711d22be5565c7e44ff6108af663b2dc5abd2df573d2fa83f");

  beforeEach(() => {
    // Create a proper config using createChainForkConfig
    config = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: Infinity,
      BALANCE_PER_ADDITIONAL_CUSTODY_GROUP: 32000000000, // 32 ETH per group
      VALIDATOR_CUSTODY_REQUIREMENT: 6,
      CUSTODY_REQUIREMENT: 4,
      SAMPLES_PER_SLOT: 8,
    });
  });

  it("custody columns present in sampled columns", () => {
    const custodyConfig = new CustodyConfig({nodeId, config});
    const {custodyColumns} = custodyConfig;
    const sampledColumns = custodyConfig.sampledColumns;

    expect(custodyColumns.length).toEqual(4);
    expect(custodyColumns).toEqual([2, 80, 89, 118]);
    expect(sampledColumns.length).toEqual(8);
    const custodyPresentInSample = custodyColumns.reduce((acc, elem) => acc && sampledColumns.includes(elem), true);
    expect(custodyPresentInSample).toEqual(true);
  });

  describe("updateCustodyRequirement", () => {
    it("should update target and sampled but not advertised", () => {
      const custodyConfig = new CustodyConfig({nodeId, config});

      expect(custodyConfig.sampledGroupCount).toBe(8);
      expect(custodyConfig.targetCustodyGroupCount).toBe(4);

      custodyConfig.updateTargetCustodyGroupCount(6);

      expect(custodyConfig.sampledGroupCount).toBe(8);
      expect(custodyConfig.targetCustodyGroupCount).toBe(6);
    });
  });
});

describe("getDataColumns", () => {
  const testCases: [string, number, number[]][] = [
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
      const nodeId = nodeIdHex.length === 64 ? fromHex(nodeIdHex) : bigIntToBytes(BigInt(nodeIdHex), 32, "be");

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

  it("validateDataColumnsSidecars", async () => {
    const chainConfig = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: Infinity,
    });
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    const chain = getMockedBeaconChain({config});
    afterEachCallbacks.push(() => chain.close());

    const slot = 0;
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const kzgProofs = blobs.flatMap((blob) => kzg.computeCellsAndKzgProofs(blob).proofs);

    const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();

    for (const kzgCommitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(kzgCommitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(kzgCommitment);
    }
    const blockRoot = ssz.fulu.BeaconBlock.hashTreeRoot(signedBeaconBlock.message);
    const columnSidecars = computeDataColumnSidecars(config, signedBeaconBlock, {
      blobs,
      kzgProofs,
    });

    expect(columnSidecars.length).toEqual(NUMBER_OF_COLUMNS);
    expect(columnSidecars[0].column.length).toEqual(blobs.length);

    await expect(
      validateDataColumnsSidecars(slot, blockRoot, kzgCommitments, columnSidecars, null)
    ).resolves.toBeUndefined();
  });

  it("fail for no blob commitments in validateDataColumnsSidecars", async () => {
    const chainConfig = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: Infinity,
    });
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    const chain = getMockedBeaconChain({config});
    afterEachCallbacks.push(() => chain.close());

    const slot = 0;
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const kzgProofs = blobs.flatMap((blob) => kzg.computeCellsAndKzgProofs(blob).proofs);

    const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();

    for (const kzgCommitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(kzgCommitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(kzgCommitment);
    }
    const blockRoot = ssz.fulu.BeaconBlock.hashTreeRoot(signedBeaconBlock.message);
    const columnSidecars = computeDataColumnSidecars(config, signedBeaconBlock, {
      blobs,
      kzgProofs,
    });

    expect(columnSidecars.length).toEqual(NUMBER_OF_COLUMNS);
    expect(columnSidecars[0].column.length).toEqual(blobs.length);

    await expect(validateDataColumnsSidecars(slot, blockRoot, [], columnSidecars, null)).rejects.toThrow(
      `Invalid data column sidecar slot=${slot}`
    );
  });
});
