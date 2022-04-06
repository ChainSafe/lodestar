import {itBench} from "@dapplion/benchmark";
import {
  ACTIVE_PRESET,
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
  PresetName,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {altair, CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../../../../src/index.js";
import {generatePerfTestCachedStateAltair, perfStateId} from "../../util";
import {BlockAltairOpts, getBlockAltair} from "../../phase0/block/util.js";
import {StateAltair} from "../../types.js";

type StateAttestations = {
  state: CachedBeaconStateAllForks;
  attestations: phase0.Attestation[];
};

// Most of the cost of processAttestation in altair is for updating participation flag tree
describe("altair processAttestation", () => {
  if (ACTIVE_PRESET !== PresetName.mainnet) {
    throw Error(`ACTIVE_PRESET ${ACTIVE_PRESET} must be mainnet`);
  }

  const testCases: {id: string; opts: BlockAltairOpts}[] = [
    {
      id: "normalcase",
      opts: {
        proposerSlashingLen: 0,
        attesterSlashingLen: 0,
        attestationLen: 90,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 90,
        // TODO: There's no data yet on how full syncCommittee will be. Assume same ratio of attestations
        syncCommitteeBitsLen: Math.round(SYNC_COMMITTEE_SIZE * 0.7),
      },
    },
    {
      id: "worstcase",
      opts: {
        proposerSlashingLen: MAX_PROPOSER_SLASHINGS,
        attesterSlashingLen: MAX_ATTESTER_SLASHINGS,
        attestationLen: MAX_ATTESTATIONS,
        depositsLen: MAX_DEPOSITS,
        voluntaryExitLen: MAX_VOLUNTARY_EXITS,
        bitsLen: 128,
        syncCommitteeBitsLen: SYNC_COMMITTEE_SIZE,
      },
    },
  ];

  for (const {id, opts} of testCases) {
    itBench<StateAttestations, StateAttestations>({
      id: `altair processAttestation - ${perfStateId} ${id}`,
      before: () => {
        const state = generatePerfTestCachedStateAltair();
        const block = getBlockAltair(state as CachedBeaconStateAltair, opts);
        return {state, attestations: block.message.body.attestations as phase0.Attestation[]};
      },
      beforeEach: ({state, attestations}) => {
        const stateCloned = state.clone();
        // Populate state array cache (on the cloned instance)
        (stateCloned as CachedBeaconStateAltair).previousEpochParticipation.getAll();
        (stateCloned as CachedBeaconStateAltair).currentEpochParticipation.getAll();
        (stateCloned as CachedBeaconStateAltair).balances.getAll();
        return {state: stateCloned, attestations};
      },
      fn: ({state, attestations}) => {
        altair.processAttestations(state as CachedBeaconStateAltair, attestations, false);
        state.commit();
        // After processAttestations normal case vc 250_000 it has to do 6802 hash64 ops
        // state.hashTreeRoot();
      },
    });
  }
});

describe("altair processAttestation - CachedEpochParticipation.setStatus", () => {
  if (ACTIVE_PRESET !== PresetName.mainnet) {
    throw Error(`ACTIVE_PRESET ${ACTIVE_PRESET} must be mainnet`);
  }

  const testCases: {name: string; ratio: number}[] = [
    {name: "1/6 committees", ratio: 1 / 6},
    {name: "1/3 committees", ratio: 1 / 3},
    {name: "1/2 committees", ratio: 1 / 2},
    {name: "2/3 committees", ratio: 2 / 3},
    {name: "4/5 committees", ratio: 4 / 5},
    {name: "100% committees", ratio: 1},
  ];
  for (const {name, ratio} of testCases) {
    itBench<StateAltair, StateAltair>({
      id: `altair processAttestation - setStatus - ${name} join`,
      before: () => {
        const state = generatePerfTestCachedStateAltair();
        state.hashTreeRoot();
        return state;
      },
      beforeEach: (state) => {
        const stateCloned = state.clone();
        // Populate state array cache (on the cloned instance)
        stateCloned.currentEpochParticipation.getAll();
        return stateCloned;
      },
      fn: (state) => {
        const {currentEpochParticipation} = state;
        const numAttesters = Math.floor(
          (state.epochCtx.currentShuffling.activeIndices.length * ratio) / SLOTS_PER_EPOCH
        );
        // just get committees of slot 10
        let count = 0;
        for (const committees of state.epochCtx.currentShuffling.committees[10]) {
          for (const committee of committees) {
            currentEpochParticipation.set(committee, 0b111);
            count++;
            if (count >= numAttesters) break;
          }
        }
      },
    });
  }
});
