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
import {ExecutionStatus, ForkChoice, IForkChoiceStore, ProtoArray} from "@lodestar/fork-choice";
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
  let forkchoice: ForkChoice;
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
    // TODO figure out why getBlockRootAtSlot(originalState, justifiedSlot) is not the same to justifiedCheckpoint.root
    const finalizedEpoch = originalState.finalizedCheckpoint.epoch;
    const finalizedCheckpoint = {
      epoch: finalizedEpoch,
      root: getBlockRootAtSlot(originalState, computeStartSlotAtEpoch(finalizedEpoch)),
    };
    const justifiedEpoch = originalState.currentJustifiedCheckpoint.epoch;
    const justifiedCheckpoint = {
      epoch: justifiedEpoch,
      root: getBlockRootAtSlot(originalState, computeStartSlotAtEpoch(justifiedEpoch)),
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

    for (let slot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch); slot < originalState.slot; slot++) {
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

    const fcStore: IForkChoiceStore = {
      currentSlot: originalState.slot,
      justified: {
        checkpoint: {...justifiedCheckpoint, rootHex: toHexString(justifiedCheckpoint.root)},
        balances: originalState.epochCtx.effectiveBalanceIncrements,
      },
      bestJustified: {
        checkpoint: {...justifiedCheckpoint, rootHex: toHexString(justifiedCheckpoint.root)},
        balances: originalState.epochCtx.effectiveBalanceIncrements,
      },
      unrealizedJustified: {
        checkpoint: {...justifiedCheckpoint, rootHex: toHexString(justifiedCheckpoint.root)},
        balances: originalState.epochCtx.effectiveBalanceIncrements,
      },
      finalizedCheckpoint: {...finalizedCheckpoint, rootHex: toHexString(finalizedCheckpoint.root)},
      unrealizedFinalizedCheckpoint: {...finalizedCheckpoint, rootHex: toHexString(finalizedCheckpoint.root)},
      justifiedBalancesGetter: () => originalState.epochCtx.effectiveBalanceIncrements,
      equivocatingIndices: new Set(),
    };
    forkchoice = new ForkChoice(originalState.config, fcStore, protoArray);
  });

  after(() => {
    sandbox.restore();
  });

  itBench({
    id: "getAttestationsForBlock",
    beforeEach: () => getAggregatedAttestationPool(originalState),
    fn: (pool) => {
      // logger.info("Number of attestations in pool", pool.getAll().length);
      pool.getAttestationsForBlock(forkchoice, originalState);
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
