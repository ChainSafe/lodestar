import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/block/externalData.js";
import {computeBlockRewards} from "../../../src/rewards/blockRewards.js";
import {computeSyncCommitteeRewards} from "../../../src/rewards/syncCommitteeRewards.js";
import {stateTransition} from "../../../src/stateTransition.js";
import {cachedStateAltairPopulateCaches, generatePerfTestCachedStateAltair} from "../../../src/testUtils/util.js";
import {CachedBeaconStateAllForks} from "../../../src/types.js";
import {getBlockAltair} from "../../perf/block/util.js";

describe("chain / rewards / syncCommitteeRewards", () => {
  const config = createBeaconConfig({...chainConfigDef, ALTAIR_FORK_EPOCH: 0}, Buffer.alloc(32, 0xaa));
  const validatorCount = 8192;
  const testCases = [
    {id: "Full participation", syncCommitteeBitsLen: SYNC_COMMITTEE_SIZE},
    {id: "Partial participation", syncCommitteeBitsLen: Math.round(SYNC_COMMITTEE_SIZE * 0.7)},
    {id: "No participation", syncCommitteeBitsLen: 0},
  ];

  for (const {id, syncCommitteeBitsLen} of testCases) {
    it(id, async () => {
      const state = generatePerfTestCachedStateAltair({vc: validatorCount, goBackOneSlot: false});
      const block = getBlockAltair(state, {
        proposerSlashingLen: 0,
        attesterSlashingLen: 0,
        attestationLen: 0,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 0,
        syncCommitteeBitsLen,
      });
      ssz.altair.BeaconBlock.hashTreeRoot(block.message);
      state.hashTreeRoot();
      cachedStateAltairPopulateCaches(state);
      const preState = state as CachedBeaconStateAllForks;

      const syncRewards = await computeSyncCommitteeRewards(
        config,
        preState.epochCtx.pubkeyCache,
        block.message,
        preState
      );
      const blockRewards = await computeBlockRewards(config, block.message, preState);
      const rewardByIndex = new Map(syncRewards.map((r) => [r.validatorIndex, r.reward]));

      const {syncCommitteeBits} = block.message.body.syncAggregate;
      const committee = preState.epochCtx.currentSyncCommitteeIndexed.validatorIndices;
      expect(rewardByIndex.size).toBe(new Set(committee).size);
      for (let i = 0; i < committee.length; i++) {
        const reward = rewardByIndex.get(committee[i]);
        expect(reward).toBeDefined();
        if (syncCommitteeBitsLen === SYNC_COMMITTEE_SIZE) {
          expect(reward, `expected reward for participant at position ${i}`).toBeGreaterThan(0);
        } else if (syncCommitteeBitsLen === 0) {
          expect(reward, `expected penalty for non-participant at position ${i}`).toBeLessThan(0);
        }
        expect(syncCommitteeBits.get(i)).toBe(syncCommitteeBitsLen > i);
      }

      const preBalances = preState.balances.getAll();
      const postState = stateTransition(preState, block, {
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        dataAvailabilityStatus: DataAvailabilityStatus.Available,
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      });
      const postBalances = postState.balances.getAll();

      for (let i = 0; i < validatorCount; i++) {
        const expected = (rewardByIndex.get(i) ?? 0) + (i === block.message.proposerIndex ? blockRewards.total : 0);
        expect(postBalances[i] - preBalances[i], `wrong balance delta for validator ${i}`).toBe(expected);
      }
    });
  }
});
