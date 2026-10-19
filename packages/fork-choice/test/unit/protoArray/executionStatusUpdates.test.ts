import {describe, expect, it} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {
  BlockExecutionStatus,
  BlockExtraMeta,
  ExecutionStatus,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";
import {LVHExecErrorCode} from "../../../src/protoArray/errors.js";

type ValidationTestCase = {
  root: string;
  bestChild?: string;
  bestDescendant?: string;
  executionStatus: ExecutionStatus | undefined;
};

type TestBlock = {slot: number; root: string; parent: string; executionStatus: BlockExecutionStatus};
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

      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,

      parentBlockHash: null,
      payloadStatus: PayloadStatus.FULL,
    } as Omit<ProtoBlock, "targetRoot">,
    0
  );

  for (const block of blocks) {
    const executionData = (
      block.executionStatus === ExecutionStatus.PreMerge
        ? {
            executionPayloadBlockHash: null,
            executionStatus: ExecutionStatus.PreMerge,
            dataAvailabilityStatus: DataAvailabilityStatus.PreData,
          }
        : {
            executionPayloadBlockHash: block.root,
            executionPayloadNumber: block.slot,
            executionPayloadGasLimit: 30000000,
            executionStatus: block.executionStatus,
            dataAvailabilityStatus: DataAvailabilityStatus.PreData,
          }
    ) as BlockExtraMeta;
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

        timeliness: false,
        importedTimely: false,
        ptcTimeliness: false,
        proposerIndex: 0,

        ...executionData,

        parentBlockHash: null,
        payloadStatus: PayloadStatus.FULL,
      },
      block.slot,
      null
    );
  }

  const deltas = Array.from({length: fc.nodes.length}, () => 0);
  fc.applyScoreChanges({
    attestationDeltas: deltas,
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
    expect(preValidation).toEqual(expectedPreValidationFC);
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
      invalidateFromParentBlockRoot: "3C",
      invalidateFromParentBlockHash: "3C",
    },
    3
  );

  const invalidate3CValidate2CForkChoice = collectProtoarrayValidationStatus(fc);
  it("correcly invalidate 3C and validate 2C only", () => {
    expect(invalidate3CValidate2CForkChoice).toEqual(
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
    expect(validate3B2B1A).toEqual(
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
      invalidateFromParentBlockRoot: "3A",
      invalidateFromParentBlockHash: "3A",
    },
    3
  );
  const invalidate3A2A = collectProtoarrayValidationStatus(fc);
  it("Invalidate 3A, 2A with 2A loosing its bestChild, bestDescendant", () => {
    expect(invalidate3A2A).toEqual(
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
    expect(preValidation).toEqual(expectedPreValidationFC);
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
      invalidateFromParentBlockRoot: "3B",
      invalidateFromParentBlockHash: "3B",
    },
    3
  );
  const postMergeInvalidated = collectProtoarrayValidationStatus(fc);
  it("all post merge blocks should be invalidated except Cs", () => {
    expect(postMergeInvalidated).toEqual(
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
    // findHead returns ProtoNode
    // For pre-Gloas blocks, this should have blockRoot "0" and payloadStatus FULL (2)
    expect(fcHead.blockRoot).toBe("0");
    expect(fcHead.payloadStatus).toBe(2); // PayloadStatus.FULL
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
    expect(preValidation).toEqual(expectedPreValidationFC);
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
    expect(validate3B2B1A).toEqual(
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
          invalidateFromParentBlockRoot: "3A",
          invalidateFromParentBlockHash: "3A",
        },
        3
      )
    ).toThrow(Error);

    expect(fc.lvhError).toEqual({lvhCode: LVHExecErrorCode.ValidToInvalid, blockRoot: "1A", execHash: "1A"});
    expect(() => fc.findHead("0", 3)).toThrow(Error);
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
    expect(preValidation).toEqual(expectedPreValidationFC);
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
      invalidateFromParentBlockRoot: "3B",
      invalidateFromParentBlockHash: "3B",
    },
    3
  );
  const validate3B2B1A = collectProtoarrayValidationStatus(fc);
  it("Inalidate 3B, 2B, 1A", () => {
    expect(validate3B2B1A).toEqual(
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
    ).toThrow(Error);

    expect(fc.lvhError).toEqual({lvhCode: LVHExecErrorCode.InvalidToValid, blockRoot: "2A", execHash: "2A"});
    expect(() => fc.findHead("0", 3)).toThrow(Error);
  });
});

describe("executionStatus / null LVH invalidates only the queried payload", () => {
  const fc = setupForkChoice();

  /**
   *  0 (PreMerge) <- 1A (Syncing) <- 2A (Syncing) <- 3A (Invalid)
   *                               ^- 2B (Syncing) <- 3B (Syncing)
   *                               ~~ 2C (Syncing) <- 3C (Syncing)
   */
  const applied = fc.validateLatestHash(
    {
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: null,
      invalidateFromParentBlockRoot: "3A",
      invalidateFromParentBlockHash: "3A",
    },
    3,
    {strict: false}
  );
  const nullLVH = collectProtoarrayValidationStatus(fc);
  it("invalidates 3A and nothing above it", () => {
    expect(applied).toBe(true);
    expect(nullLVH).toEqual(
      toFcTestCase([
        ["0", "1A", "3B", ExecutionStatus.PreMerge],
        ["1A", "2B", "3B", ExecutionStatus.Syncing],
        ["2A", undefined, undefined, ExecutionStatus.Syncing],
        ["3A", undefined, undefined, ExecutionStatus.Invalid],
        ["2B", "3B", "3B", ExecutionStatus.Syncing],
        ["3B", undefined, undefined, ExecutionStatus.Syncing],
        ["2C", "3C", "3C", ExecutionStatus.Syncing],
        ["3C", undefined, undefined, ExecutionStatus.Syncing],
      ])
    );
  });
});

describe("executionStatus / lenient verdicts never contradict an earlier VALID", () => {
  const fc = setupForkChoice();
  fc.validateLatestHash({executionStatus: ExecutionStatus.Valid, latestValidExecHash: "1A"}, 3);

  it("skips a VALID node without poisoning the tree", () => {
    const applied = fc.validateLatestHash(
      {
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        invalidateFromParentBlockRoot: "1A",
        invalidateFromParentBlockHash: "1A",
      },
      3,
      {strict: false}
    );
    expect(applied).toBe(false);
    expect(fc.lvhError).toBeUndefined();
    expect(fc.getNode("1A", PayloadStatus.FULL)?.executionStatus).toBe(ExecutionStatus.Valid);
  });

  /**
   * LVH points below the VALID 1A, so it is treated as unknown: only 3A is invalidated
   *
   *  0 (PreMerge) <- 1A (Valid)   <- 2A (Syncing) <- 3A (Invalid)
   */
  it("treats an LVH below a VALID node as unknown", () => {
    const applied = fc.validateLatestHash(
      {
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        invalidateFromParentBlockRoot: "3A",
        invalidateFromParentBlockHash: "3A",
      },
      3,
      {strict: false}
    );
    expect(applied).toBe(true);
    expect(fc.lvhError).toBeUndefined();
    expect(collectProtoarrayValidationStatus(fc)).toEqual(
      toFcTestCase([
        ["0", "1A", "3B", ExecutionStatus.PreMerge],
        ["1A", "2B", "3B", ExecutionStatus.Valid],
        ["2A", undefined, undefined, ExecutionStatus.Syncing],
        ["3A", undefined, undefined, ExecutionStatus.Invalid],
        ["2B", "3B", "3B", ExecutionStatus.Syncing],
        ["3B", undefined, undefined, ExecutionStatus.Syncing],
        ["2C", "3C", "3C", ExecutionStatus.Syncing],
        ["3C", undefined, undefined, ExecutionStatus.Syncing],
      ])
    );
  });

  it("is a no-op for an already invalidated node", () => {
    const applied = fc.validateLatestHash(
      {
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: null,
        invalidateFromParentBlockRoot: "3A",
        invalidateFromParentBlockHash: "3A",
      },
      3,
      {strict: false}
    );
    expect(applied).toBe(false);
  });
});

describe("executionStatus / lenient verdicts never cross the justified node", () => {
  const fc = setupForkChoice();
  fc.applyScoreChanges({
    attestationDeltas: Array.from({length: fc.nodes.length}, () => 0),
    proposerBoost: null,
    justifiedEpoch: 1,
    justifiedRoot: "2A",
    finalizedEpoch: 0,
    finalizedRoot: "-",
    currentSlot: 3,
  });

  /**
   * LVH is 1A, below the justified 2A. Only 3A is invalidated, 2A stays Syncing.
   */
  it("stops below the justified node", () => {
    const applied = fc.validateLatestHash(
      {
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: "1A",
        invalidateFromParentBlockRoot: "3A",
        invalidateFromParentBlockHash: "3A",
      },
      3,
      {strict: false}
    );
    expect(applied).toBe(true);
    expect(fc.getNode("3A", PayloadStatus.FULL)?.executionStatus).toBe(ExecutionStatus.Invalid);
    expect(fc.getNode("2A", PayloadStatus.FULL)?.executionStatus).toBe(ExecutionStatus.Syncing);
    expect(fc.findHead("2A", 3).blockRoot).toBe("2A");
  });
});

function collectProtoarrayValidationStatus(fcArray: ProtoArray): ValidationTestCase[] {
  const expectedForkChoice: ValidationTestCase[] = [];

  for (const fcRoot of fcRoots) {
    const defaultStatus = fcArray.getDefaultVariant(fcRoot);
    const fcNode = defaultStatus !== undefined ? fcArray.getNode(fcRoot, defaultStatus) : undefined;
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
