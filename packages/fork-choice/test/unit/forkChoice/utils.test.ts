import {expect} from "chai";
import {createChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {assertValidTerminalPowBlock, ExecutionStatus} from "../../../src/index.js";

describe("assertValidTerminalPowBlock", function () {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createChainForkConfig({TERMINAL_TOTAL_DIFFICULTY: BigInt(10)});
  const block = ssz.bellatrix.BeaconBlock.defaultValue();
  const executionStatus = ExecutionStatus.Valid;
  it("should accept ttd >= genesis block as terminal without powBlockParent", function () {
    const powBlock = {
      blockHash: "0x" + "ab".repeat(32),
      // genesis powBlock will have zero parent hash
      parentHash: "0x" + "00".repeat(32),
      totalDifficulty: BigInt(10),
    };
    expect(() =>
      assertValidTerminalPowBlock(config, block, {executionStatus, powBlockParent: null, powBlock})
    ).to.not.throw();
  });

  it("should require powBlockParent if powBlock not genesis", function () {
    const powBlock = {
      blockHash: "0x" + "ab".repeat(32),
      // genesis powBlock will have non zero parent hash
      parentHash: "0x" + "01".repeat(32),
      totalDifficulty: BigInt(10),
    };
    expect(() =>
      assertValidTerminalPowBlock(config, block, {executionStatus, powBlockParent: null, powBlock})
    ).to.throw();
  });

  it("should require powBlock >= ttd", function () {
    const powBlock = {
      blockHash: "0x" + "ab".repeat(32),
      // genesis powBlock will have non zero parent hash
      parentHash: "0x" + "01".repeat(32),
      totalDifficulty: BigInt(9),
    };
    expect(() =>
      assertValidTerminalPowBlock(config, block, {executionStatus, powBlockParent: powBlock, powBlock})
    ).to.throw();
  });

  it("should require powBlockParent < ttd", function () {
    const powBlock = {
      blockHash: "0x" + "ab".repeat(32),
      // genesis powBlock will have non zero parent hash
      parentHash: "0x" + "01".repeat(32),
      totalDifficulty: BigInt(10),
    };
    expect(() =>
      assertValidTerminalPowBlock(config, block, {executionStatus, powBlockParent: powBlock, powBlock})
    ).to.throw();
  });

  it("should accept powBlockParent < ttd and powBlock >= ttd", function () {
    const powBlock = {
      blockHash: "0x" + "ab".repeat(32),
      // genesis powBlock will have non zero parent hash
      parentHash: "0x" + "01".repeat(32),
      totalDifficulty: BigInt(10),
    };
    const powBlockParent = {
      ...powBlock,
      totalDifficulty: BigInt(9),
    };
    expect(() =>
      assertValidTerminalPowBlock(config, block, {executionStatus, powBlockParent, powBlock})
    ).to.not.throw();
  });
});
