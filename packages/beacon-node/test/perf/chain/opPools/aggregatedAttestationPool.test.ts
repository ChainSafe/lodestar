import {SinonStubbedInstance} from "sinon";
import sinon from "sinon";
import {itBench} from "@dapplion/benchmark";
import {expect} from "chai";
import {
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
} from "@lodestar/state-transition";
import {HISTORICAL_ROOTS_LIMIT, SLOTS_PER_EPOCH, TIMELY_SOURCE_FLAG_INDEX} from "@lodestar/params";
import {BitArray, toHexString} from "@chainsafe/ssz";
import {ExecutionStatus, ForkChoice, IForkChoice, ProtoArray} from "@lodestar/fork-choice";
import {AggregatedAttestationPool} from "../../../../src/chain/opPools/aggregatedAttestationPool.js";
import {generatePerfTestCachedStateAltair} from "../../../../../state-transition/test/perf/util.js";
import {computeAnchorCheckpoint} from "../../../../src/chain/initState.js";

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
function flagIsTimelySource(flag: number): boolean {
  return (flag & TIMELY_SOURCE) === TIMELY_SOURCE;
}

// Aug 11 2021
// getAttestationsForBlock
//     ✓ getAttestationsForBlock                                             4.410948 ops/s    226.7086 ms/op        -         64 runs   51.8 s
describe("getAttestationsForBlock", () => {
  let originalState: CachedBeaconStateAltair;
  let protoArray: ProtoArray;
  let forkchoiceStub: SinonStubbedInstance<IForkChoice>;
  const sandbox = sinon.createSandbox();

  before(function () {
    this.timeout(2 * 60 * 1000); // Generating the states for the first time is very slow

    originalState = generatePerfTestCachedStateAltair({goBackOneSlot: true});

    const previousEpochParticipationArr = originalState.previousEpochParticipation.getAll();
    const currentEpochParticipationArr = originalState.currentEpochParticipation.getAll();

    const numPreviousEpochParticipation = previousEpochParticipationArr.filter(flagIsTimelySource).length;
    const numCurrentEpochParticipation = currentEpochParticipationArr.filter(flagIsTimelySource).length;

    expect(numPreviousEpochParticipation).to.equal(250000, "Wrong numPreviousEpochParticipation");
    expect(numCurrentEpochParticipation).to.equal(250000, "Wrong numCurrentEpochParticipation");

    const {blockHeader, checkpoint} = computeAnchorCheckpoint(originalState.config, originalState);
    const finalizedCheckpoint = {...checkpoint};
    const justifiedCheckpoint = {
      ...checkpoint,
      epoch: checkpoint.epoch === 0 ? checkpoint.epoch : checkpoint.epoch + 1,
    };

    protoArray = ProtoArray.initialize(
      {
        slot: blockHeader.slot,
        parentRoot: toHexString(blockHeader.parentRoot),
        stateRoot: toHexString(blockHeader.stateRoot),
        blockRoot: toHexString(checkpoint.root),

        justifiedEpoch: justifiedCheckpoint.epoch,
        justifiedRoot: toHexString(justifiedCheckpoint.root),
        finalizedEpoch: finalizedCheckpoint.epoch,
        finalizedRoot: toHexString(finalizedCheckpoint.root),
        unrealizedJustifiedEpoch: justifiedCheckpoint.epoch,
        unrealizedJustifiedRoot: toHexString(justifiedCheckpoint.root),
        unrealizedFinalizedEpoch: finalizedCheckpoint.epoch,
        unrealizedFinalizedRoot: toHexString(finalizedCheckpoint.root),
        executionPayloadBlockHash: null,
        executionStatus: ExecutionStatus.PreMerge,
      },
      originalState.slot
    );

    for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
      const slot = originalState.slot - SLOTS_PER_EPOCH + epochSlot;
      const epoch = computeEpochAtSlot(slot);
      protoArray.onBlock(
        {
          slot,
          blockRoot: toHexString(getBlockRootAtSlot(originalState, slot)),
          parentRoot: toHexString(getBlockRootAtSlot(originalState, slot - 1)),
          stateRoot: toHexString(originalState.stateRoots.get(slot % HISTORICAL_ROOTS_LIMIT)),
          targetRoot: toHexString(getBlockRootAtSlot(originalState, computeStartSlotAtEpoch(epoch))),
          justifiedEpoch: justifiedCheckpoint.epoch,
          justifiedRoot: toHexString(justifiedCheckpoint.root),
          finalizedEpoch: finalizedCheckpoint.epoch,
          finalizedRoot: toHexString(finalizedCheckpoint.root),
          unrealizedJustifiedEpoch: justifiedCheckpoint.epoch,
          unrealizedJustifiedRoot: toHexString(justifiedCheckpoint.root),
          unrealizedFinalizedEpoch: finalizedCheckpoint.epoch,
          unrealizedFinalizedRoot: toHexString(finalizedCheckpoint.root),
          executionPayloadBlockHash: null,
          executionStatus: ExecutionStatus.PreMerge,
        },
        slot
      );
    }
    forkchoiceStub = sandbox.createStubInstance(ForkChoice);
    const lastBlockRoot = toHexString(getBlockRootAtSlot(originalState, originalState.slot - 1));
    // instead of having a real Forkchoice instance which needs a complicated setup
    // we create same backing ProtoArray, this has the same performance to the real iterateAncestorBlocks()
    forkchoiceStub.iterateAncestorBlocks.returns(protoArray.iterateAncestorNodes(lastBlockRoot));
  });

  after(() => {
    sandbox.restore();
  });

  itBench({
    id: "getAttestationsForBlock",
    beforeEach: () => getAggregatedAttestationPool(originalState),
    fn: (pool) => {
      // logger.info("Number of attestations in pool", pool.getAll().length);
      pool.getAttestationsForBlock(forkchoiceStub, originalState);
    },
  });
});

function getAggregatedAttestationPool(state: CachedBeaconStateAltair): AggregatedAttestationPool {
  const pool = new AggregatedAttestationPool();
  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slot = state.slot - 1 - epochSlot;
    const epoch = computeEpochAtSlot(slot);
    const committeeCount = state.epochCtx.getCommitteeCountPerSlot(epoch);
    const sourceCheckpoint = {
      epoch: state.currentJustifiedCheckpoint.epoch,
      root: state.currentJustifiedCheckpoint.root,
    };
    for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
      const attestation = {
        aggregationBits: BitArray.fromBitLen(64),
        data: {
          slot: slot,
          index: committeeIndex,
          beaconBlockRoot: getBlockRootAtSlot(state, slot),
          source: sourceCheckpoint,
          target: {
            epoch,
            root: getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch)),
          },
        },
        signature: Buffer.alloc(96),
      };

      const committee = state.epochCtx.getBeaconCommittee(slot, committeeIndex);
      // all attestation has full participation so getAttestationsForBlock() has to do a lot of filter
      // aggregate_and_proof messages
      pool.add(attestation, committee.length, committee);
    }
  }
  return pool;
}
