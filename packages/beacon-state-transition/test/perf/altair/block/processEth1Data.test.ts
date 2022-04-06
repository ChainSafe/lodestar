import {itBench} from "@dapplion/benchmark";
import {ACTIVE_PRESET, PresetName, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {allForks, CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../../../../src/index.js";
import {generatePerfTestCachedStateAltair, perfStateId} from "../../util";
import {getBlockAltair} from "../../phase0/block/util.js";
import {phase0} from "@chainsafe/lodestar-types";

type StateEth1Data = {
  state: CachedBeaconStateAllForks;
  eth1Data: phase0.Eth1Data;
};

// Most of the cost of processAttestation in altair is for updating participation flag tree
describe("altair processEth1Data", () => {
  if (ACTIVE_PRESET !== PresetName.mainnet) {
    throw Error(`ACTIVE_PRESET ${ACTIVE_PRESET} must be mainnet`);
  }

  const testCases: {id: string}[] = [
    {id: "normalcase"},
    // TODO: What's a worst case for eth1Data?
    // {id: "worstcase"}
  ];

  for (const {id} of testCases) {
    itBench<StateEth1Data, StateEth1Data>({
      id: `altair processEth1Data - ${perfStateId} ${id}`,
      before: () => {
        const state = generatePerfTestCachedStateAltair();
        const block = getBlockAltair(state as CachedBeaconStateAltair, {
          proposerSlashingLen: 0,
          attesterSlashingLen: 0,
          attestationLen: 90,
          depositsLen: 0,
          voluntaryExitLen: 0,
          bitsLen: 90,
          // TODO: There's no data yet on how full syncCommittee will be. Assume same ratio of attestations
          syncCommitteeBitsLen: Math.round(SYNC_COMMITTEE_SIZE * 0.7),
        });
        state.hashTreeRoot();
        return {state, eth1Data: block.message.body.eth1Data};
      },
      beforeEach: ({state, eth1Data}) => {
        const stateCloned = state.clone();
        // Populate nodes cache of eth1DataVotes array (on the cloned instance)
        stateCloned.eth1DataVotes.getAllReadonly();
        return {state: stateCloned, eth1Data};
      },
      fn: ({state, eth1Data}) => {
        allForks.processEth1Data(state, eth1Data);
      },
    });
  }
});
