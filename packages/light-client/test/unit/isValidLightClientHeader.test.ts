import {describe, it, expect} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {LightClientHeader, ssz} from "@lodestar/types";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {isValidLightClientHeader} from "../../src/spec/utils.js";

describe("isValidLightClientHeader", function () {
  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 1,
    DENEB_FORK_EPOCH: Infinity,
  });

  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  const altairLCHeader = {
    beacon: {
      slot: 5,
      proposerIndex: 29852,
      parentRoot: fromHexString("0x2490c4e438b6c1476c4a666011955f6a239b82e7c31af452ee72e263e8a82cef"),
      stateRoot: fromHexString("0x95f9a788a5ebed7275dc809978064ddf62a57864a0c48b10aa87e9ebec87b6c5"),
      bodyRoot: fromHexString("0x48a2ebb21de0cf70f599d4c0bcdb2e4ca791d5e9b396cbebfe50ce3295396041"),
    },
  };

  const altairUpgradedCapellaLCHeader = {
    beacon: altairLCHeader.beacon,
    execution: ssz.capella.LightClientHeader.fields.execution.defaultValue(),
    executionBranch: ssz.capella.LightClientHeader.fields.executionBranch.defaultValue(),
  };

  const altairUpgradedDenebLCHeader = {
    beacon: altairLCHeader.beacon,
    execution: ssz.deneb.LightClientHeader.fields.execution.defaultValue(),
    executionBranch: ssz.deneb.LightClientHeader.fields.executionBranch.defaultValue(),
  };

  const capellaLCHeader = {
    beacon: {
      slot: 100936,
      proposerIndex: 29852,
      parentRoot: fromHexString("0x2490c4e438b6c1476c4a666011955f6a239b82e7c31af452ee72e263e8a82cef"),
      stateRoot: fromHexString("0x95f9a788a5ebed7275dc809978064ddf62a57864a0c48b10aa87e9ebec87b6c5"),
      bodyRoot: fromHexString("0x48a2ebb21de0cf70f599d4c0bcdb2e4ca791d5e9b396cbebfe50ce3295396041"),
    },
    execution: {
      parentHash: fromHexString("0x8dbfa7d03da88416dabda95cf83e3d2c7bbc820bfbe2a685a2a629eda54b2320"),
      feeRecipient: fromHexString("0xf97e180c050e5ab072211ad2c213eb5aee4df134"),
      stateRoot: fromHexString("0x51a4df7228204e2d2ba15c8664c16b7abd41480e8087727a96d3b84e04f661d8"),
      receiptsRoot: fromHexString("0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"),
      logsBloom: fromHexString(
        "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
      ),
      prevRandao: fromHexString("0x7408cf3778b7d879b3317160858c3ef2818d2cad53dbf3a638af598c351be46b"),
      blockNumber: 96392,
      gasLimit: 30000000,
      gasUsed: 0,
      timestamp: 1676474832,
      extraData: fromHexString("0x"),
      baseFeePerGas: BigInt(7),
      blockHash: fromHexString("0x5570e6072f4e469f256fd2c2d0ee7ddce2da8cce8b0ac1b36495e5aa25987e7b"),
      transactionsRoot: fromHexString("0x7ffe241ea60187fdb0187bfa22de35d1f9bed7ab061d9401fd47e34a54fbede1"),
      withdrawalsRoot: fromHexString("0x21bb571478b90df5866e87aa358f5a5e93682db3ba242baf2bdf127f2a9a54ce"),
    },
    executionBranch: [
      fromHexString("0xbc9397945c24273581f86275332d37761dff3b9fdaaddee03749bcee644213a8"),
      fromHexString("0x336488033fe5f3ef4ccc12af07b9370b92e553e35ecb4a337a1b1c0e4afe1e0e"),
      fromHexString("0xdb56114e00fdd4c1f85c892bf35ac9a89289aaecb1ebd0a96cde606a748b5d71"),
      fromHexString("0x8bbebf0f8b663cd4a56f3739019e52507ba6c6b99ad530ab36925c12d84b7b5e"),
    ],
  };

  const capellaUpgradedDenebHeader = {
    beacon: capellaLCHeader.beacon,
    execution: {...capellaLCHeader.execution, blobGasUsed: 0, excessBlobGas: 0},
    executionBranch: capellaLCHeader.executionBranch,
  };

  const testCases: [string, LightClientHeader][] = [
    ["altair LC header", altairLCHeader],
    ["altair upgraded to capella", altairUpgradedCapellaLCHeader],
    ["altair upgraded to deneb", altairUpgradedDenebLCHeader],
    ["capella LC header", capellaLCHeader],
    ["capella upgraded to deneb LC header", capellaUpgradedDenebHeader],
  ];

  for (const [name, header] of testCases) {
    it(name, function () {
      const isValid = isValidLightClientHeader(config, header);
      expect(isValid).toBe(true);
    });
  }
});
