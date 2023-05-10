import {expect} from "chai";
import sinon from "sinon";
import {RootHex} from "@lodestar/types";
import {ForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {Slot} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {ZERO_HASH_HEX, ZERO_HASH} from "../../../../src/constants/index.js";
import {StubbedBeaconDb, StubbedChainMutable} from "../../../utils/stub/index.js";
import {testLogger} from "../../../utils/logger.js";
import {Archiver} from "../../../../src/chain/archiver/index.js";
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

  const testCases = [
    {
      id: "all - 1 orphaned, 0 missed, attached - 1 orphan 0 missed ",
      finalizedCanonicalBlocks: makeBlock([16, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
      finalizedNonCanonicalBlocks: makeBlock([14]),
      finalizedCanonicalCheckpoints: [
        {epoch: 2, rootHex: ZERO_HASH_HEX, root: ZERO_HASH},
        {epoch: 1, rootHex: ZERO_HASH_HEX, root: ZERO_HASH},
      ],
      prevFinalized: {epoch: 0, rootHex: ZERO_HASH_HEX, root: ZERO_HASH},
      attachedValidators: ["1", "2", "3", "4", "5", "6", "7", "8"],
      allValidators: ["1", "2", "3", "4", "5", "6", "7", "8"],
      finalized: {epoch: 2, rootHex: ZERO_HASH_HEX, root: ZERO_HASH},
      returnVal: {
        allValidators: {expected: 16, finalized: 15, orphaned: 1, missed: 0},
        attachedValidators: {expected: 16, finalized: 15, orphaned: 1, missed: 0},
        finalizedCanonicalCheckpointsCount: 2,
        finalizedFoundCheckpointsInStateCache: 3,
        finalizedAttachedValidatorsCount: 8,
      },
    },
    // {
    //   id: "all - 0 orphaned, 1 missed, attached - 0 orphan 1 missed ",
    //   finalizedCanonicalBlocks: makeBlock([16, 15, 13,12,11,10,9,8,7,6,5,4,3,2,1]),
    //   finalizedNonCanonicalBlocks: [],
    //   finalizedCanonicalCheckpoints:  [
    //     { epoch: 2, rootHex: ZERO_HASH_HEX },
    //     { epoch: 1, rootHex: ZERO_HASH_HEX }
    //   ],
    //   prevFinalized:{ epoch: 0, rootHex: ZERO_HASH_HEX },
    //   attachedValidators: ["1","2","3","4","5","6","7","8"],
    //   allValidators: ["1","2","3","4","5","6","7","8"],
    //   finalized: { epoch: 2, rootHex: ZERO_HASH_HEX },
    //   returnVal : {allValidators : {expected: 16, finalized: 15, orphaned: 0, missed:1},
    //   attachedValidators: {expected: 16, finalized: 15, orphaned: 0, missed:1},
    //   finalizedCanonicalCheckpointsCount : 2,
    //   finalizedFoundCheckpointsInStateCache :3,
    //   finalizedAttachedValidatorsCount: 8}
    // },
    // {
    //   id: "all - 1 orphaned, 1 missed, attached - 1 orphan 1 missed ",
    //   finalizedCanonicalBlocks: makeBlock([16, 15,12,11,10,9,]),
    //   finalizedNonCanonicalBlocks: [14],
    //   finalizedCanonicalCheckpoints:  [
    //     { epoch: 2, rootHex: ZERO_HASH_HEX },
    //   ],
    //   prevFinalized:{ epoch: 1, rootHex: ZERO_HASH_HEX },
    //   attachedValidators: ["1","2","3","4","5","6","7","8"],
    //   allValidators: ["1","2","3","4","5","6","7","8"],
    //   finalized: { epoch: 2, rootHex: ZERO_HASH_HEX },
    //   returnVal : {allValidators : {expected: 8, finalized: 6, orphaned: 1, missed:1},
    //   attachedValidators: {expected: 8, finalized: 6, orphaned: 1, missed:1},
    //   finalizedCanonicalCheckpointsCount : 1,
    //   finalizedFoundCheckpointsInStateCache : 2,
    //   finalizedAttachedValidatorsCount: 8}
    // },
    // {
    //   id: "all - 0 orphaned, 0 missed, attached - 0 orphan 0 missed ",
    //   finalizedCanonicalBlocks: makeBlock([24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,]),
    //   finalizedNonCanonicalBlocks: [],
    //   finalizedCanonicalCheckpoints:  [
    //     { epoch: 3, rootHex: ZERO_HASH_HEX },
    //     { epoch: 2, rootHex: ZERO_HASH_HEX }
    //   ],
    //   prevFinalized:{ epoch: 1, rootHex: ZERO_HASH_HEX },
    //   attachedValidators: ["1","2","3","4","5","6","7","8"],
    //   allValidators: ["1","2","3","4","5","6","7","8"],
    //   finalized: { epoch: 3, rootHex: ZERO_HASH_HEX },
    //   returnVal : {allValidators : {expected: 16, finalized: 16, orphaned: 0, missed:0},
    //     attachedValidators: {expected: 16, finalized: 16, orphaned: 0, missed:0},
    //     finalizedCanonicalCheckpointsCount : 2,
    //     finalizedFoundCheckpointsInStateCache :3,
    //     finalizedAttachedValidatorsCount: 8}
    // },
    // {
    //   id: "all - 1 orphaned, 0 missed, attached - 0 orphan, 0 missed ",
    //   finalizedCanonicalBlocks: makeBlock([7,6,5,4,3,2,1]),
    //   finalizedNonCanonicalBlocks: [8],
    //   finalizedCanonicalCheckpoints:  [
    //     { epoch: 1, rootHex: ZERO_HASH_HEX }
    //   ],
    //   prevFinalized:{ epoch: 0, rootHex: ZERO_HASH_HEX },
    //   attachedValidators: ["3","4","5","6","7","8"],
    //   allValidators: ["1","2","3","4","5","6","7","8"],
    //   finalized: { epoch: 1, rootHex: ZERO_HASH_HEX },
    //   returnVal : {allValidators : {expected: 8, finalized: 7, orphaned: 1, missed:0},
    //   attachedValidators: {expected: 6, finalized: 6, orphaned: 0, missed:0},
    //   finalizedCanonicalCheckpointsCount : 1,
    //   finalizedFoundCheckpointsInStateCache :2,
    //   finalizedAttachedValidatorsCount: 6}
    // },
    // {
    //   id: "all - 0 orphaned, 1 missed, attached - 0 orphan, 0 missed ",
    //   finalizedCanonicalBlocks: makeBlock([7,6,5,4,3,2,1]),
    //   finalizedNonCanonicalBlocks: [],
    //   finalizedCanonicalCheckpoints:  [
    //     { epoch: 1, rootHex: ZERO_HASH_HEX }
    //   ],
    //   prevFinalized:{ epoch: 0, rootHex: ZERO_HASH_HEX },
    //   attachedValidators: ["3","4","5","6","7","8"],
    //   allValidators: ["1","2","3","4","5","6","7","8"],
    //   finalized: { epoch: 1, rootHex: ZERO_HASH_HEX },
    //   returnVal : {allValidators : {expected: 8, finalized: 7, orphaned: 0, missed:1},
    //   attachedValidators: {expected: 6, finalized: 6, orphaned: 0, missed:0},
    //   finalizedCanonicalCheckpointsCount : 1,
    //   finalizedFoundCheckpointsInStateCache :2,
    //   finalizedAttachedValidatorsCount: 6}
    // },
  ];

  for (const {
    id,
    finalizedCanonicalCheckpoints,
    finalizedCanonicalBlocks,
    finalizedNonCanonicalBlocks,
    prevFinalized,
    attachedValidators,
    allValidators,
    finalized,
    returnVal,
  } of testCases) {
    it(id, async function () {
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

      expect(returnVal).to.deep.equal(processedStats);
    });
  }
});

function makeBlock(blockSlots: Slot[]): ProtoBlock[] {
  return blockSlots.map((slot) => {
    return {slot: slot, proposerIndex: (slot % 8) + 1} as ProtoBlock;
  });
}

function addtoBeaconCache(cache: BeaconProposerCache, epoch: number, proposers: string[]): void {
  const suggestedFeeRecipient = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  proposers.forEach((eachProposer) => {
    cache.add(epoch, {validatorIndex: eachProposer, feeRecipient: suggestedFeeRecipient});
  });
}

function addDummyStateCache(
  checkpointStateCache: BeaconChain["checkpointStateCache"],
  checkpoint: {epoch: number; rootHex: RootHex},
  proposers: string[]
): void {
  const rootCP = {epoch: checkpoint.epoch, root: fromHexString(checkpoint.rootHex)};

  const checkpointstate = generateCachedState();
  checkpointstate.epochCtx.proposers = proposers.map((each) => Number(each));
  checkpointstate.epochCtx.epoch = checkpoint.epoch;
  checkpointStateCache.add(rootCP, checkpointstate);
}
