import {expect} from "chai";
import sinon from "sinon";
import {Epoch} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch, computeEpochAtSlot} from "@lodestar/state-transition";
import {fromHexString} from "@chainsafe/ssz";
import {ZERO_HASH_HEX, ZERO_HASH} from "../../../../src/constants/index.js";
import {StatesArchiver} from "../../../../src/chain/archiver/archiveStates.js";
import {StubbedChainMutable} from "../../../utils/stub/index.js";
import {testLogger} from "../../../utils/logger.js";
import {BeaconChain, CheckpointStateCache} from "../../../../src/chain/index.js";
import {IBeaconDb} from "../../../../src/index.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {startTmpBeaconDb} from "../../../utils/db.js";
import {generateCachedState} from "../../../utils/state.js";

describe("maybeArchiveState", function () {
  const logger = testLogger();
  let chainStub: StubbedChainMutable<"checkpointStateCache">;
  let db: BeaconDb;
  let stateArchiver: StatesArchiver;

  beforeEach(async function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.checkpointStateCache = new CheckpointStateCache({});
    db = await startTmpBeaconDb(config);
  });

  afterEach(async () => {
    await db.stop();
  });

  // testcases are array of [finalizedEpochs,expected archivedEpochs]
  const testcases: [Epoch[], Epoch[]][] = [
    [
      [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 18, 19, 20, 21, 23, 25, 26, 27, 28, 30, 31, 32, 33],
      [1, 32, 33],
    ],
    [
      [
        1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 18, 19, 20, 21, 23, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36,
        37, 39, 40, 42, 43, 44,
      ],
      [1, 32, 44],
    ],
    [
      [
        1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 18, 19, 20, 21, 23, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36,
        37, 39, 40, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52, 53, 54, 56, 58, 60, 62, 63, 65, 66, 68, 70, 71, 74, 75, 77,
        80, 82, 83, 84, 88, 90, 92, 94, 97, 98, 100, 102,
      ],
      [1, 65, 97, 102],
    ],
    [
      [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
      [0, 22],
    ],
    [
      [7, 8, 35, 70],
      [7, 70],
    ],
    [
      [
        0, 20, 33, 40, 45, 50, 60, 64, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145,
        150, 155, 160, 165, 170, 175, 180, 185, 190,
      ],
      [0, 64, 130, 160, 190],
    ],
    [
      [
        0, 20, 33, 40, 45, 50, 60, 64, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145,
        150, 155, 160, 165, 170, 175, 180, 185, 190, 200,
      ],
      [0, 64, 130, 200],
    ],
    [
      [
        0, 20, 33, 40, 45, 50, 60, 64, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145,
        150, 155, 160, 165, 170, 175, 180, 185, 190, 200, 205, 210, 220,
      ],
      [0, 64, 130, 200, 220],
    ],
  ];

  testcases.forEach((eachTestcase, i) => {
    it(i + 1 + " should archive finalized states and delete correct ones", async function () {
      const [finalizedEpochs, archivedStateSlots] = eachTestcase;

      const finalizedCP = finalizedEpochs.map((epoch) => {
        return {epoch, rootHex: ZERO_HASH_HEX, root: ZERO_HASH};
      });

      stateArchiver = new StatesArchiver(
        chainStub.checkpointStateCache as StatesArchiver["checkpointStateCache"],
        db as IBeaconDb,
        logger,
        {archiveStateEpochFrequency: 64}
      );

      for (const eachCP of finalizedCP) {
        addDummyStateCache(chainStub["checkpointStateCache"], eachCP);
        await stateArchiver.maybeArchiveState(eachCP);
        chainStub["checkpointStateCache"].pruneFinalized(eachCP.epoch);
      }

      const finalArchivedStates = await db.stateArchive.keys();
      const finalArchivedEpochs = finalArchivedStates.map((eachslot) => {
        return computeEpochAtSlot(eachslot);
      });
      // console.log("Final archived keys", finalArchivedEpochs);
      expect(finalArchivedEpochs).to.be.deep.equal(archivedStateSlots);
    });
  });
});

function addDummyStateCache(
  checkpointStateCache: BeaconChain["checkpointStateCache"],
  checkpoint: CheckpointWithHex
): void {
  const rootCP = {epoch: checkpoint.epoch, root: fromHexString(checkpoint.rootHex)};
  const checkpointstate = generateCachedState();
  checkpointstate.epochCtx.epoch = checkpoint.epoch;
  checkpointstate.slot = computeStartSlotAtEpoch(checkpoint.epoch);
  checkpointStateCache.add(rootCP, checkpointstate);
}
