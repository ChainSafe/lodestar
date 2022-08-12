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

const expectedPreValidationFC: ValidationTestCase[] = [
  {
    root: "0",
    bestChild: "1A",
    bestDescendant: "3B",
    executionStatus: ExecutionStatus.PreMerge,
  },
  {root: "1A", bestChild: "2B", bestDescendant: "3B", executionStatus: ExecutionStatus.Syncing},
  {root: "2A", bestChild: "3A", bestDescendant: "3A", executionStatus: ExecutionStatus.Syncing},
  {root: "3A", bestChild: undefined, bestDescendant: undefined, executionStatus: ExecutionStatus.Syncing},
  {root: "2B", bestChild: "3B", bestDescendant: "3B", executionStatus: ExecutionStatus.Syncing},
  {root: "3B", bestChild: undefined, bestDescendant: undefined, executionStatus: ExecutionStatus.Syncing},
  {root: "2C", bestChild: "3C", bestDescendant: "3C", executionStatus: ExecutionStatus.Syncing},
  {root: "3C", bestChild: undefined, bestDescendant: undefined, executionStatus: ExecutionStatus.Syncing},
];

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
    expect(invalidate3CValidate2CForkChoice).to.be.deep.equal([
      {
        root: "0",
        bestChild: "1A",
        bestDescendant: "3B",
        executionStatus: ExecutionStatus.PreMerge,
      },
      {
        root: "1A",
        bestChild: "2B",
        bestDescendant: "3B",
        executionStatus: "Syncing",
      },
      {
        root: "2A",
        bestChild: "3A",
        bestDescendant: "3A",
        executionStatus: "Syncing",
      },
      {
        root: "3A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
      {
        root: "2B",
        bestChild: "3B",
        bestDescendant: "3B",
        executionStatus: "Syncing",
      },
      {
        root: "3B",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
      {
        root: "2C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
      {
        root: "3C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
    ]);
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
    expect(validate3B2B1A).to.be.deep.equal([
      {
        root: "0",
        bestChild: "1A",
        bestDescendant: "3B",
        executionStatus: ExecutionStatus.PreMerge,
      },
      {
        root: "1A",
        bestChild: "2B",
        bestDescendant: "3B",
        executionStatus: "Valid",
      },
      {
        root: "2A",
        bestChild: "3A",
        bestDescendant: "3A",
        executionStatus: "Syncing",
      },
      {
        root: "3A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
      {
        root: "2B",
        bestChild: "3B",
        bestDescendant: "3B",
        executionStatus: "Valid",
      },
      {
        root: "3B",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Valid",
      },
      {
        root: "2C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
      {
        root: "3C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
    ]);
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
    expect(invalidate3A2A).to.be.deep.equal([
      {
        root: "0",
        bestChild: "1A",
        bestDescendant: "3B",
        executionStatus: ExecutionStatus.PreMerge,
      },
      {
        root: "1A",
        bestChild: "2B",
        bestDescendant: "3B",
        executionStatus: "Valid",
      },
      {
        root: "2A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "3A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "2B",
        bestChild: "3B",
        bestDescendant: "3B",
        executionStatus: "Valid",
      },
      {
        root: "3B",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Valid",
      },
      {
        root: "2C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
      {
        root: "3C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
    ]);
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
    expect(postMergeInvalidated).to.be.deep.equal([
      {
        root: "0",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: ExecutionStatus.PreMerge,
      },
      {
        root: "1A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "2A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "3A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "2B",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "3B",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "2C",
        bestChild: "3C",
        bestDescendant: "3C",
        executionStatus: "Syncing",
      },
      {
        root: "3C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
    ]);
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
    expect(validate3B2B1A).to.be.deep.equal([
      {
        root: "0",
        bestChild: "1A",
        bestDescendant: "3B",
        executionStatus: ExecutionStatus.PreMerge,
      },
      {
        root: "1A",
        bestChild: "2B",
        bestDescendant: "3B",
        executionStatus: "Valid",
      },
      {
        root: "2A",
        bestChild: "3A",
        bestDescendant: "3A",
        executionStatus: "Syncing",
      },
      {
        root: "3A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
      {
        root: "2B",
        bestChild: "3B",
        bestDescendant: "3B",
        executionStatus: "Valid",
      },
      {
        root: "3B",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Valid",
      },
      {
        root: "2C",
        bestChild: "3C",
        bestDescendant: "3C",
        executionStatus: "Syncing",
      },
      {
        root: "3C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
    ]);
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
    expect(validate3B2B1A).to.be.deep.equal([
      {
        root: "0",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: ExecutionStatus.PreMerge,
      },
      {
        root: "1A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "2A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "3A",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "2B",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "3B",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Invalid",
      },
      {
        root: "2C",
        bestChild: "3C",
        bestDescendant: "3C",
        executionStatus: "Syncing",
      },
      {
        root: "3C",
        bestChild: undefined,
        bestDescendant: undefined,
        executionStatus: "Syncing",
      },
    ]);
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
      fcNode?.bestChild !== undefined ? fcArray.getNodeFromIndex(fcNode.bestChild).blockRoot : undefined;
    const bestDescendant =
      fcNode?.bestDescendant !== undefined ? fcArray.getNodeFromIndex(fcNode.bestDescendant).blockRoot : undefined;
    expectedForkChoice.push({
      root: fcRoot,
      bestChild,
      bestDescendant,
      executionStatus: fcNode?.executionStatus,
    });
  }
  return expectedForkChoice;
}
