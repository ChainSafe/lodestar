import {itBench} from "@dapplion/benchmark";
import {BitArray, toHexString} from "@chainsafe/ssz";
import {
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
  newFilledArray,
} from "@lodestar/state-transition";
import {HISTORICAL_ROOTS_LIMIT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ExecutionStatus, ForkChoice, IForkChoiceStore, ProtoArray} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
// eslint-disable-next-line import/no-relative-packages
import {generatePerfTestCachedStateAltair} from "../../../../../state-transition/test/perf/util.js";
import {AggregatedAttestationPool} from "../../../../src/chain/opPools/aggregatedAttestationPool.js";
import {computeAnchorCheckpoint} from "../../../../src/chain/initState.js";

const vc = 1_500_000;

/**
 * Jan 2024
 *   getAttestationsForBlock
    ✔ notSeenSlots=1 numMissedVotes=1 numBadVotes=10                      9.152280 ops/s    109.2624 ms/op        -         48 runs   60.3 s
    ✔ notSeenSlots=1 numMissedVotes=0 numBadVotes=4                       9.173290 ops/s    109.0121 ms/op        -         52 runs   38.1 s
    ✔ notSeenSlots=2 numMissedVotes=1 numBadVotes=10                      18.10215 ops/s    55.24205 ms/op        -         18 runs   34.0 s   ✔ notSeenSlots=2 numMissedVotes=1 numBadVotes=10                      25.31025 ops/s    39.50969 ms/op        -         15 runs   31.3 s
 */
describe(`getAttestationsForBlock vc=${vc}`, () => {
  let originalState: CachedBeaconStateAltair;
  let protoArray: ProtoArray;
  let forkchoice: ForkChoice;

  before(function () {
    this.timeout(5 * 60 * 1000); // Generating the states for the first time is very slow

    originalState = generatePerfTestCachedStateAltair({goBackOneSlot: true, vc});

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

    let totalBalance = 0;
    for (let i = 0; i < originalState.epochCtx.effectiveBalanceIncrements.length; i++) {
      totalBalance += originalState.epochCtx.effectiveBalanceIncrements[i];
    }

    const fcStore: IForkChoiceStore = {
      currentSlot: originalState.slot,
      justified: {
        checkpoint: {...justifiedCheckpoint, rootHex: toHexString(justifiedCheckpoint.root)},
        balances: originalState.epochCtx.effectiveBalanceIncrements,
        totalBalance,
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

  // notSeenSlots should be >=1
  for (const [notSeenSlots, numMissedVotes, numBadVotes] of [
    [1, 1, 10],
    [1, 0, 4],
    // notSeenSlots=2 means the previous block slot is missed
    [2, 1, 10],
  ]) {
    itBench({
      id: `notSeenSlots=${notSeenSlots} numMissedVotes=${numMissedVotes} numBadVotes=${numBadVotes}`,
      before: () => {
        const state = originalState.clone();
        // by default make all validators have full participation
        const previousParticipation = newFilledArray(vc, 0b111);
        // origState is at slot 0 of epoch so there is no currentParticipation
        const currentParticipation = newFilledArray(vc, 0);
        const currentEpoch = computeEpochAtSlot(state.slot);

        for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
          const slot = state.slot - 1 - epochSlot;
          const slotEpoch = computeEpochAtSlot(slot);
          const committeeCount = state.epochCtx.getCommitteeCountPerSlot(slotEpoch);
          for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
            const duties = state.epochCtx.getBeaconCommittee(slot, committeeIndex);
            const participationArr = slotEpoch === currentEpoch ? currentParticipation : previousParticipation;
            for (const [i, validatorIndex] of duties.entries()) {
              // no attestation in previous slot is included yet as that's the spec
              // for slot < previous slot, there is missed votes at every committee so the code need to keep looking for attestations because votes are not seen
              if (slot >= state.slot - notSeenSlots || i < numMissedVotes) {
                participationArr[validatorIndex] = 0;
              }
            }
          }
        }
        state.previousEpochParticipation = ssz.altair.EpochParticipation.toViewDU(previousParticipation);
        state.currentEpochParticipation = ssz.altair.EpochParticipation.toViewDU(currentParticipation);
        state.commit();
        return state;
      },
      beforeEach: (state) => {
        const pool = getAggregatedAttestationPool(state, numMissedVotes, numBadVotes);
        return {state, pool};
      },
      fn: ({state, pool}) => {
        pool.getAttestationsForBlock(forkchoice, state);
      },
    });
  }
});

/**
 * Create the pool with the following properties:
 * - state: at slot n
 * - all attestations at slot n - 1 are included in block but they are not enough
 * - numMissedVotes: number of missed attestations/votes at every committee
 * - numBadVotes: number of bad attestations/votes at every committee, they are not included in block because they are seen in the state
 */
function getAggregatedAttestationPool(
  state: CachedBeaconStateAltair,
  numMissedVotes: number,
  numBadVotes: number
): AggregatedAttestationPool {
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
      const goodAttData = {
        slot: slot,
        index: committeeIndex,
        beaconBlockRoot: getBlockRootAtSlot(state, slot),
        source: sourceCheckpoint,
        target: {
          epoch,
          root: getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch)),
        },
      };

      // for each good att data group, there are 4 versions of aggregation bits
      const committee = state.epochCtx.getBeaconCommittee(slot, committeeIndex);
      const committeeSize = committee.length;
      const goodVoteBits = BitArray.fromBoolArray(Array.from({length: committeeSize}, () => true));
      // n first validators are totally missed
      for (let i = 0; i < numMissedVotes; i++) {
        goodVoteBits.set(i, false);
      }
      // n next validators vote for different att data
      for (let i = 0; i < numBadVotes; i++) {
        goodVoteBits.set(i + numMissedVotes, false);
      }

      // there are 4 different versions of the good vote
      for (const endingBits of [0b1000, 0b0100, 0b0010, 0b0001]) {
        const aggregationBits = goodVoteBits.clone();
        aggregationBits.set(committeeSize - 1, Boolean(endingBits & 0b0001));
        aggregationBits.set(committeeSize - 2, Boolean(endingBits & 0b0010));
        aggregationBits.set(committeeSize - 3, Boolean(endingBits & 0b0100));
        aggregationBits.set(committeeSize - 4, Boolean(endingBits & 0b1000));

        const attestation = {
          aggregationBits,
          data: goodAttData,
          signature: Buffer.alloc(96),
        };
        // all attestation has full participation so getAttestationsForBlock() has to do a lot of filter
        // aggregate_and_proof messages
        pool.add(
          attestation,
          toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation.data)),
          committee.length,
          committee
        );
      }

      if (epochSlot === 0) {
        // epochSlot === 0: attestations will be included in block but it's not enough for block
        // epochSlot >= 1: no attestation will be included in block but the code still need to scan through them
        continue;
      }

      const zeroAggregationBits = BitArray.fromBoolArray(Array.from({length: committeeSize}, () => false));

      // n first validator votes for n different bad votes, that makes n different att data in the same slot/index
      // these votes/attestations will NOT be included in block as they are seen in the state
      for (let i = 0; i < numBadVotes; i++) {
        const attData = ssz.phase0.AttestationData.clone(goodAttData);
        attData.beaconBlockRoot = getBlockRootAtSlot(state, slot - i - 1);
        const aggregationBits = zeroAggregationBits.clone();
        aggregationBits.set(i + numMissedVotes, true);
        const attestation = {
          aggregationBits,
          data: attData,
          signature: Buffer.alloc(96),
        };
        pool.add(
          attestation,
          toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation.data)),
          committee.length,
          committee
        );
      }
    }
  }
  return pool;
}
