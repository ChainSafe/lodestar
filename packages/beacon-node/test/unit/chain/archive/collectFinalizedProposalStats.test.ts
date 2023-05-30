import {expect} from "chai";
import sinon from "sinon";
import {RootHex, Slot, Epoch, ValidatorIndex} from "@lodestar/types";
import {ForkChoice, ProtoBlock, CheckpointWithHex} from "@lodestar/fork-choice";
import {fromHexString} from "@chainsafe/ssz";
import {ZERO_HASH_HEX, ZERO_HASH} from "../../../../src/constants/index.js";
import {StubbedBeaconDb, StubbedChainMutable} from "../../../utils/stub/index.js";
import {testLogger} from "../../../utils/logger.js";
import {Archiver, FinalizedStats} from "../../../../src/chain/archiver/index.js";
import {FinalizedData} from "../../../../src/chain/archiver/archiveBlocks.js";
import {BeaconChain, CheckpointStateCache} from "../../../../src/chain/index.js";
import {BeaconProposerCache} from "../../../../src/chain/beaconProposerCache.js";
import {generateCachedState} from "../../../utils/state.js";

describe("collectFinalizedProposalStats", function () {
  const logger = testLogger();

  let chainStub: StubbedChainMutable<
    "forkChoice" | "stateCache" | "emitter" | "beaconProposerCache" | "checkpointStateCache"
  >;

  let dbStub: StubbedBeaconDb;
  // let beaconProposerCacheStub = SinonStubbedInstance<BeaconProposerCache> & BeaconProposerCache;
  let archiver: Archiver;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.forkChoice = sinon.createStubInstance(ForkChoice);
    const suggestedFeeRecipient = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    chainStub.beaconProposerCache = new BeaconProposerCache({suggestedFeeRecipient});
    chainStub.checkpointStateCache = new CheckpointStateCache({});
    const controller = new AbortController();

    dbStub = new StubbedBeaconDb();
    archiver = new Archiver(
      dbStub as Archiver["db"],
      chainStub as Archiver["chain"],
      logger,
      controller.signal,
      {archiveStateEpochFrequency: 10, disableArchiveOnCheckpoint: true},
      null
    );
  });

  // Each test case is:
  //   name, canonical slots [], non canonical slots [], finalized checkpoints [],
  //     [prev finalized, latest finalized], attached validators[], exected stats
  const testCases1: [string, Slot[], Slot[], Epoch[], [Epoch, Epoch], ValidatorIndex[], FinalizedStats][] = [
    [
      "allVals - E:16, F:15, O:1, M:0 attachVals(8) - E:16, F:15, O:1, M:0",
      [16, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      [14],
      [2, 1],
      [0, 2],
      [1, 2, 3, 4, 5, 6, 7, 8],
      {
        allValidators: {total: 16, finalized: 15, orphaned: 1, missed: 0},
        attachedValidators: {total: 16, finalized: 15, orphaned: 1, missed: 0},
        finalizedCanonicalCheckpointsCount: 2,
        finalizedFoundCheckpointsInStateCache: 3,
        finalizedAttachedValidatorsCount: 8,
      },
    ],
    [
      "allVals - E:16, F:15, O:0, M:1 attachVals(8) - E:16, F:15, O:0, M:1",
      [16, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      [],
      [2, 1],
      [0, 2],
      [1, 2, 3, 4, 5, 6, 7, 8],
      {
        allValidators: {total: 16, finalized: 15, orphaned: 0, missed: 1},
        attachedValidators: {total: 16, finalized: 15, orphaned: 0, missed: 1},
        finalizedCanonicalCheckpointsCount: 2,
        finalizedFoundCheckpointsInStateCache: 3,
        finalizedAttachedValidatorsCount: 8,
      },
    ],
    [
      "allVals - E:8, F:6, O:1, M:1 attachVals(8) - E:8, F:6, O:1, M:1",
      [16, 14, 12, 11, 10, 9],
      [15],
      [2],
      [1, 2],
      [1, 2, 3, 4, 5, 6, 7, 8],
      {
        allValidators: {total: 8, finalized: 6, orphaned: 1, missed: 1},
        attachedValidators: {total: 8, finalized: 6, orphaned: 1, missed: 1},
        finalizedCanonicalCheckpointsCount: 1,
        finalizedFoundCheckpointsInStateCache: 2,
        finalizedAttachedValidatorsCount: 8,
      },
    ],
    [
      "allVals - E:16, F:16, O:0, M:0 attachVals(8) - E:16, F:16, O:0, M:0",
      [24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9],
      [],
      [3, 2],
      [1, 3],
      [1, 2, 3, 4, 5, 6, 7, 8],
      {
        allValidators: {total: 16, finalized: 16, orphaned: 0, missed: 0},
        attachedValidators: {total: 16, finalized: 16, orphaned: 0, missed: 0},
        finalizedCanonicalCheckpointsCount: 2,
        finalizedFoundCheckpointsInStateCache: 3,
        finalizedAttachedValidatorsCount: 8,
      },
    ],
    [
      "allVals - E:8, F:7, O:1, M:0 attachVals(6) - E:6, F:6, O:0, M:0",
      [7, 6, 5, 4, 3, 2, 1],
      [8],
      [1],
      [0, 1],
      [3, 4, 5, 6, 7, 8],
      {
        allValidators: {total: 8, finalized: 7, orphaned: 1, missed: 0},
        attachedValidators: {total: 6, finalized: 6, orphaned: 0, missed: 0},
        finalizedCanonicalCheckpointsCount: 1,
        finalizedFoundCheckpointsInStateCache: 2,
        finalizedAttachedValidatorsCount: 6,
      },
    ],
    [
      "allVals - E:8, F:7, O:0, M:1 attachVals(6) - E:6, F:6, O:0, M:0",
      [7, 6, 5, 4, 3, 2, 1],
      [],
      [1],
      [0, 1],
      [3, 4, 5, 6, 7, 8],
      {
        allValidators: {total: 8, finalized: 7, orphaned: 0, missed: 1},
        attachedValidators: {total: 6, finalized: 6, orphaned: 0, missed: 0},
        finalizedCanonicalCheckpointsCount: 1,
        finalizedFoundCheckpointsInStateCache: 2,
        finalizedAttachedValidatorsCount: 6,
      },
    ],
  ];
  const allValidators = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const [
    id,
    finalizedCanonicalBlockSlots,
    finalizedNonCanonicalBlockSlots,
    finalizedCanonicalCheckpointEpochs,
    [prevFinalizedEpoch, finalizedEpoch],
    attachedValidators,
    expectedStats,
  ] of testCases1) {
    it(id, async function () {
      const finalizedCanonicalBlocks = finalizedCanonicalBlockSlots.map(makeBlock);
      const finalizedNonCanonicalBlocks = finalizedNonCanonicalBlockSlots.map(makeBlock);
      const finalizedCanonicalCheckpoints = finalizedCanonicalCheckpointEpochs.map(makeCheckpoint);
      const prevFinalized = makeCheckpoint(prevFinalizedEpoch);
      const finalized = makeCheckpoint(finalizedEpoch);

      addtoBeaconCache(chainStub["beaconProposerCache"], finalized.epoch, attachedValidators);
      addDummyStateCache(chainStub["checkpointStateCache"], prevFinalized, allValidators);
      finalizedCanonicalCheckpoints.forEach((eachCheckpoint) => {
        addDummyStateCache(chainStub["checkpointStateCache"], eachCheckpoint, allValidators);
      });

      const finalizedData = {finalizedCanonicalCheckpoints, finalizedCanonicalBlocks, finalizedNonCanonicalBlocks};
      const processedStats = archiver["collectFinalizedProposalStats"](
        chainStub.checkpointStateCache,
        chainStub.forkChoice,
        chainStub.beaconProposerCache,
        finalizedData as FinalizedData,
        finalized,
        prevFinalized
      );

      expect(expectedStats).to.deep.equal(processedStats);
    });
  }
});

function makeBlock(slot: Slot): ProtoBlock {
  return {slot: slot, proposerIndex: (slot % 8) + 1} as ProtoBlock;
}

function makeCheckpoint(epoch: Epoch): CheckpointWithHex {
  return {epoch, rootHex: ZERO_HASH_HEX, root: ZERO_HASH};
}

function addtoBeaconCache(cache: BeaconProposerCache, epoch: number, proposers: ValidatorIndex[]): void {
  const suggestedFeeRecipient = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  proposers.forEach((eachProposer) => {
    cache.add(epoch, {validatorIndex: `${eachProposer}`, feeRecipient: suggestedFeeRecipient});
  });
}

function addDummyStateCache(
  checkpointStateCache: BeaconChain["checkpointStateCache"],
  checkpoint: {epoch: number; rootHex: RootHex},
  proposers: number[]
): void {
  const rootCP = {epoch: checkpoint.epoch, root: fromHexString(checkpoint.rootHex)};

  const checkpointstate = generateCachedState();
  checkpointstate.epochCtx.proposers = proposers;
  checkpointstate.epochCtx.epoch = checkpoint.epoch;
  checkpointStateCache.add(rootCP, checkpointstate);
}
