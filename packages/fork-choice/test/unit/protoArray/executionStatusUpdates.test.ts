import {expect} from "chai";
import {
  ProtoBlock,
  ProtoArray,
  ExecutionStatus,
  MaybeValidExecutionStatus,
  BlockExecution,
} from "../../../src/index.js";
import {LVHExecErrorCode} from "../../../src/protoArray/errors.js";

type ValidationTestCase = {
  root: string;
  bestChild?: string;
  bestDescendant?: string;
  executionStatus: ExecutionStatus | undefined;
};

type TestBlock = {slot: number; root: string; parent: string; executionStatus: MaybeValidExecutionStatus};
type TestCase = [string, string | undefined, string | undefined, ExecutionStatus];
const blocks: TestBlock[] = [
  {slot: 1, root: "1A", parent: "0", executionStatus: ExecutionStatus.Syncing},
  {slot: 2, root: "2A", parent: "1A", executionStatus: ExecutionStatus.Syncing},
  {slot: 3, root: "3A", parent: "2A", executionStatus: ExecutionStatus.Syncing},
  {slot: 2, root: "2B", parent: "1A", executionStatus: ExecutionStatus.Syncing},
  {slot: 2, root: "3B", parent: "2B", executionStatus: ExecutionStatus.Syncing},
  {slot: 2, root: "2C", parent: "none", executionStatus: ExecutionStatus.Syncing},
  {slot: 3, root: "3C", parent: "2C", executionStatus: ExecutionStatus.Syncing},
];
const fcRoots: string[] = ["0"];
for (const block of blocks) {
  fcRoots.push(block.root);
}

function toFcTestCase(testCases: TestCase[]): ValidationTestCase[] {
  return testCases.map((testCase) => ({
    root: testCase[0],
    bestChild: testCase[1],
    bestDescendant: testCase[2],
    executionStatus: testCase[3],
  }));
}

const expectedPreValidationFC1: TestCase[] = [
  ["0", "1A", "3B", ExecutionStatus.PreMerge],
  ["1A", "2B", "3B", ExecutionStatus.Syncing],
  ["2A", "3A", "3A", ExecutionStatus.Syncing],
  ["3A", undefined, undefined, ExecutionStatus.Syncing],
  ["2B", "3B", "3B", ExecutionStatus.Syncing],
  ["3B", undefined, undefined, ExecutionStatus.Syncing],
  ["2C", "3C", "3C", ExecutionStatus.Syncing],
  ["3C", undefined, undefined, ExecutionStatus.Syncing],
];
const expectedPreValidationFC: ValidationTestCase[] = toFcTestCase(expectedPreValidationFC1);

/**
 * Set up the following forkchoice  (~~ parent not in forkchoice, possibly bogus/NA)
 *
 *  0 (PreMerge) <- 1A (Syncing) <- 2A (Syncing) <- 3A (Syncing)
 *                               ^- 2B (Syncing) <- 3B (Syncing)
 *                               ~~ 2C (Syncing) <- 3C (Syncing)
 */

function setupForkChoice(): ProtoArray {
  const fc = ProtoArray.initialize(
    {
      slot: 0,
      stateRoot: "-",
      parentRoot: "-",
      blockRoot: "0",

      justifiedEpoch: 0,
      justifiedRoot: "-",
      finalizedEpoch: 0,
      finalizedRoot: "-",

      ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
    } as Omit<ProtoBlock, "targetRoot">,
    0
  );

  for (const block of blocks) {
    const executionData = (block.executionStatus === ExecutionStatus.PreMerge
      ? {executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge}
      : {executionPayloadBlockHash: block.root, executionStatus: block.executionStatus}) as BlockExecution;
    fc.onBlock(
      {
        slot: block.slot,
        blockRoot: block.root,
        parentRoot: block.parent,
        stateRoot: "-",
        targetRoot: "-",

        justifiedEpoch: 0,
        justifiedRoot: "-",
        finalizedEpoch: 0,
        finalizedRoot: "-",

        unrealizedJustifiedEpoch: 0,
        unrealizedJustifiedRoot: "-",
        unrealizedFinalizedEpoch: 0,
        unrealizedFinalizedRoot: "-",

        ...executionData,
      },
      block.slot
    );
  }

  const deltas = Array.from({length: fc.nodes.length}, () => 0);
  fc.applyScoreChanges({
    deltas,
    proposerBoost: null,
    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
    currentSlot: 3,
  });
  return fc;
}

describe("executionStatus / normal updates", () => {
  const fc = setupForkChoice();

  /**
   *  0 (PreMerge) <- 1A (Syncing) <- 2A (Syncing) <- 3A (Syncing)
   *                               ^- 2B (Syncing) <- 3B (Syncing)
   *                               ~~ 2C (Syncing) <- 3C (Syncing)
   */
  const preValidation = collectProtoarrayValidationStatus(fc);
  it("preValidation forkchoice setup should be correct", () => {
    expect(preValidation).to.be.deep.equal(expectedPreValidationFC);
  });

  /**
   * Invalidate 3C with LVH on 2C which stays in Syncing
   *
   *  0 (PreMerge) <- 1A (Syncing) <- 2A (Syncing) <- 3A (Syncing)
   *                               ^- 2B (Syncing) <- 3B (Syncing)
   *                               ~~ 2C (Syncing) <- 3C (Invalid)
   */
  fc.validateLatestHash(
    {
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: "2C",
      invalidateFromBlockHash: "3C",
    },
    3
  );

  const invalidate3CValidate2CForkChoice = collectProtoarrayValidationStatus(fc);
  it("correcly invalidate 3C and validate 2C only", () => {
    expect(invalidate3CValidate2CForkChoice).to.be.deep.equal(
      toFcTestCase([
        ["0", "1A", "3B", ExecutionStatus.PreMerge],
        ["1A", "2B", "3B", ExecutionStatus.Syncing],
        ["2A", "3A", "3A", ExecutionStatus.Syncing],
        ["3A", undefined, undefined, ExecutionStatus.Syncing],
        ["2B", "3B", "3B", ExecutionStatus.Syncing],
        ["3B", undefined, undefined, ExecutionStatus.Syncing],
        ["2C", undefined, undefined, ExecutionStatus.Syncing],
        ["3C", undefined, undefined, ExecutionStatus.Invalid],
      ])
    );
  });

  /**
   * Validate 3B, 2B, 1A (premerge)
   *
   *  0 (PreMerge) <- 1A (Valid)   <- 2A (Syncing) <- 3A (Syncing)
   *                               ^- 2B (Valid)   <- 3B (Valid)
   *                               ~~ 2C (Syncing) <- 3C (Invalid)
   */
  fc.validateLatestHash(
    {
      executionStatus: ExecutionStatus.Valid,
      latestValidExecHash: "3B",
    },
    3
  );
  const validate3B2B1A = collectProtoarrayValidationStatus(fc);
  it("Validate 3B, 2B, 1A", () => {
    expect(validate3B2B1A).to.be.deep.equal(
      toFcTestCase([
        ["0", "1A", "3B", ExecutionStatus.PreMerge],
        ["1A", "2B", "3B", ExecutionStatus.Valid],
        ["2A", "3A", "3A", ExecutionStatus.Syncing],
        ["3A", undefined, undefined, ExecutionStatus.Syncing],
        ["2B", "3B", "3B", ExecutionStatus.Valid],
        ["3B", undefined, undefined, ExecutionStatus.Valid],
        ["2C", undefined, undefined, ExecutionStatus.Syncing],
        ["3C", undefined, undefined, ExecutionStatus.Invalid],
      ])
    );
  });

  /**
   * Invalidate 3A, 2A with 2A loosing its bestChild, bestDescendant
   *
   *  0 (PreMerge) <- 1A (Valid)   <- 2A (Invalid) <- 3A (Invalid)
   *                               ^- 2B (Valid)   <- 3B (Valid)
   *                               ~~ 2C (Syncing) <- 3C (Invalid)
   */

  fc.validateLatestHash(
    {
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: "1A",
      invalidateFromBlockHash: "3A",
    },
    3
  );
  const invalidate3A2A = collectProtoarrayValidationStatus(fc);
  it("Invalidate 3A, 2A with 2A loosing its bestChild, bestDescendant", () => {
    expect(invalidate3A2A).to.be.deep.equal(
      toFcTestCase([
        ["0", "1A", "3B", ExecutionStatus.PreMerge],
        ["1A", "2B", "3B", ExecutionStatus.Valid],
        ["2A", undefined, undefined, ExecutionStatus.Invalid],
        ["3A", undefined, undefined, ExecutionStatus.Invalid],
        ["2B", "3B", "3B", ExecutionStatus.Valid],
        ["3B", undefined, undefined, ExecutionStatus.Valid],
        ["2C", undefined, undefined, ExecutionStatus.Syncing],
        ["3C", undefined, undefined, ExecutionStatus.Invalid],
      ])
    );
  });
});

describe("executionStatus / invalidate all postmerge chain", () => {
  const fc = setupForkChoice();

  /**
   * Set up the following forkchoice  (~~ parent not in forkchoice, possibly bogus/NA)
   *
   *  0 (PreMerge) <- 1A (Syncing) <- 2A (Syncing) <- 3A (Syncing)
   *                               ^- 2B (Syncing) <- 3B (Syncing)
   *                               ~~ 2C (Syncing) <- 3C (Syncing)
   */
  const preValidation = collectProtoarrayValidationStatus(fc);
  it("preValidation forkchoice setup should be correct", () => {
    expect(preValidation).to.be.deep.equal(expectedPreValidationFC);
  });

  /**
   * All post merge blocks should be invalidated except Cs
   *
   *  0 (PreMerge) <- 1A (Invalid) <- 2A (Invalid) <- 3A (Invalid)
   *                               ^- 2B (Invalid) <- 3B (Invalid)
   *                               ~~ 2C (Syncing) <- 3C (Syncing)
   */
  fc.validateLatestHash(
    {
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      invalidateFromBlockHash: "3B",
    },
    3
  );
  const postMergeInvalidated = collectProtoarrayValidationStatus(fc);
  it("all post merge blocks should be invalidated except Cs", () => {
    expect(postMergeInvalidated).to.be.deep.equal(
      toFcTestCase([
        ["0", undefined, undefined, ExecutionStatus.PreMerge],
        ["1A", undefined, undefined, ExecutionStatus.Invalid],
        ["2A", undefined, undefined, ExecutionStatus.Invalid],
        ["3A", undefined, undefined, ExecutionStatus.Invalid],
        ["2B", undefined, undefined, ExecutionStatus.Invalid],
        ["3B", undefined, undefined, ExecutionStatus.Invalid],
        ["2C", "3C", "3C", ExecutionStatus.Syncing],
        ["3C", undefined, undefined, ExecutionStatus.Syncing],
      ])
    );
  });

  const fcHead = fc.findHead("0", 3);
  it("pre merge block should be the FC head", () => {
    expect(fcHead).to.be.equal("0");
  });
});

describe("executionStatus / poision forkchoice if we invalidate previous valid", () => {
  const fc = setupForkChoice();

  /**
   * Set up the following forkchoice  (~~ parent not in forkchoice, possibly bogus/NA)
   *
   *  0 (PreMerge) <- 1A (Syncing) <- 2A (Syncing) <- 3A (Syncing)
   *                               ^- 2B (Syncing) <- 3B (Syncing)
   *                               ~~ 2C (Syncing) <- 3C (Syncing)
   */
  const preValidation = collectProtoarrayValidationStatus(fc);
  it("preValidation forkchoice setup should be correct", () => {
    expect(preValidation).to.be.deep.equal(expectedPreValidationFC);
  });

  /**
   * Validate 3B, 2B, 1A (premerge)
   *
   *  0 (PreMerge) <- 1A (Valid)   <- 2A (Syncing) <- 3A (Syncing)
   *                               ^- 2B (Valid)   <- 3B (Valid)
   *                               ~~ 2C (Syncing) <- 3C (Syncing)
   */
  fc.validateLatestHash(
    {
      executionStatus: ExecutionStatus.Valid,
      latestValidExecHash: "3B",
    },
    3
  );
  const validate3B2B1A = collectProtoarrayValidationStatus(fc);
  it("Validate 3B, 2B, 1A", () => {
    expect(validate3B2B1A).to.be.deep.equal(
      toFcTestCase([
        ["0", "1A", "3B", ExecutionStatus.PreMerge],
        ["1A", "2B", "3B", ExecutionStatus.Valid],
        ["2A", "3A", "3A", ExecutionStatus.Syncing],
        ["3A", undefined, undefined, ExecutionStatus.Syncing],
        ["2B", "3B", "3B", ExecutionStatus.Valid],
        ["3B", undefined, undefined, ExecutionStatus.Valid],
        ["2C", "3C", "3C", ExecutionStatus.Syncing],
        ["3C", undefined, undefined, ExecutionStatus.Syncing],
      ])
    );
  });

  it("protoarray should be poisioned with a buggy LVH response", () => {
    expect(() =>
      fc.validateLatestHash(
        {
          executionStatus: ExecutionStatus.Invalid,
          latestValidExecHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          invalidateFromBlockHash: "3A",
        },
        3
      )
    ).to.throw(Error);

    expect(fc.lvhError).to.be.deep.equal({lvhCode: LVHExecErrorCode.ValidToInvalid, blockRoot: "1A", execHash: "1A"});
    expect(() => fc.findHead("0", 3)).to.throw(Error);
  });
});

describe("executionStatus / poision forkchoice if we validate previous invalid", () => {
  const fc = setupForkChoice();

  /**
   * Set up the following forkchoice  (~~ parent not in forkchoice, possibly bogus/NA)
   *
   *  0 (PreMerge) <- 1A (Syncing) <- 2A (Syncing) <- 3A (Syncing)
   *                               ^- 2B (Syncing) <- 3B (Syncing)
   *                               ~~ 2C (Syncing) <- 3C (Syncing)
   */
  const preValidation = collectProtoarrayValidationStatus(fc);
  it("preValidation forkchoice setup should be correct", () => {
    expect(preValidation).to.be.deep.equal(expectedPreValidationFC);
  });

  /**
   * Invalidate 3B, 2B, 1A
   *
   *  0 (PreMerge) <- 1A (Invalid) <- 2A (Invalid) <- 3A (Invalid)
   *                               ^- 2B (Invalid)   <- 3B (Invalid)
   *                               ~~ 2C (Syncing) <- 3C (Syncing)
   */
  fc.validateLatestHash(
    {
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      invalidateFromBlockHash: "3B",
    },
    3
  );
  const validate3B2B1A = collectProtoarrayValidationStatus(fc);
  it("Inalidate 3B, 2B, 1A", () => {
    expect(validate3B2B1A).to.be.deep.equal(
      toFcTestCase([
        ["0", undefined, undefined, ExecutionStatus.PreMerge],
        ["1A", undefined, undefined, ExecutionStatus.Invalid],
        ["2A", undefined, undefined, ExecutionStatus.Invalid],
        ["3A", undefined, undefined, ExecutionStatus.Invalid],
        ["2B", undefined, undefined, ExecutionStatus.Invalid],
        ["3B", undefined, undefined, ExecutionStatus.Invalid],
        ["2C", "3C", "3C", ExecutionStatus.Syncing],
        ["3C", undefined, undefined, ExecutionStatus.Syncing],
      ])
    );
  });

  it("protoarray should be poisioned with a buggy LVH response", () => {
    expect(() =>
      fc.validateLatestHash(
        {
          executionStatus: ExecutionStatus.Valid,
          latestValidExecHash: "2A",
        },
        3
      )
    ).to.throw(Error);

    expect(fc.lvhError).to.be.deep.equal({lvhCode: LVHExecErrorCode.InvalidToValid, blockRoot: "2A", execHash: "2A"});
    expect(() => fc.findHead("0", 3)).to.throw(Error);
  });
});

function collectProtoarrayValidationStatus(fcArray: ProtoArray): ValidationTestCase[] {
  const expectedForkChoice: ValidationTestCase[] = [];

  for (const fcRoot of fcRoots) {
    const fcNode = fcArray.getNode(fcRoot);
    const bestChild =
      fcNode?.bestChild !== undefined ? fcArray["getNodeFromIndex"](fcNode.bestChild).blockRoot : undefined;
    const bestDescendant =
      fcNode?.bestDescendant !== undefined ? fcArray["getNodeFromIndex"](fcNode.bestDescendant).blockRoot : undefined;
    expectedForkChoice.push({
      root: fcRoot,
      bestChild,
      bestDescendant,
      executionStatus: fcNode?.executionStatus,
    });
  }
  return expectedForkChoice;
}
