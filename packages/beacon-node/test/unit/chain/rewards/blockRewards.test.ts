import {describe, it, expect} from "vitest";
import {SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  stateTransition,
} from "@lodestar/state-transition";
import {
  generatePerfTestCachedStateAltair,
  cachedStateAltairPopulateCaches,
} from "../../../../../state-transition/test/perf/util.js";
import {BlockAltairOpts, getBlockAltair} from "../../../../../state-transition/test/perf/block/util.js";
import {computeBlockRewards} from "../../../../src/chain/rewards/blockRewards.js";

describe("chain / rewards / blockRewards", () => {
  const testCases: {id: string; opts: BlockAltairOpts}[] = [
    {
      id: "Normal case",
      opts: {
        proposerSlashingLen: 1,
        attesterSlashingLen: 2,
        attestationLen: 90,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 90,
        syncCommitteeBitsLen: Math.round(SYNC_COMMITTEE_SIZE * 0.7),
      },
    },
    {
      id: "Attestation only",
      opts: {
        proposerSlashingLen: 0,
        attesterSlashingLen: 0,
        attestationLen: 90,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 90,
        syncCommitteeBitsLen: 0,
      },
    },
    {
      id: "Sync aggregate only",
      opts: {
        proposerSlashingLen: 0,
        attesterSlashingLen: 0,
        attestationLen: 0,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 90,
        syncCommitteeBitsLen: Math.round(SYNC_COMMITTEE_SIZE * 0.7),
      },
    },
    {
      id: "Proposer slashing only",
      opts: {
        proposerSlashingLen: 2,
        attesterSlashingLen: 0,
        attestationLen: 0,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 90,
        syncCommitteeBitsLen: 0,
      },
    },
    {
      id: "Attester slashing only",
      opts: {
        proposerSlashingLen: 0,
        attesterSlashingLen: 5,
        attestationLen: 0,
        depositsLen: 0,
        voluntaryExitLen: 0,
        bitsLen: 90,
        syncCommitteeBitsLen: 0,
      },
    },
  ];

  for (const {id, opts} of testCases) {
    it(`${id}`, async () => {
      const state = generatePerfTestCachedStateAltair();
      const block = getBlockAltair(state, opts);
      // Populate permanent root caches of the block
      ssz.altair.BeaconBlock.hashTreeRoot(block.message);
      // Populate tree root caches of the state
      state.hashTreeRoot();
      cachedStateAltairPopulateCaches(state);
      const calculatedBlockReward = await computeBlockRewards(block.message, state as CachedBeaconStateAllForks);
      const {proposerIndex, total, attestations, syncAggregate, proposerSlashings, attesterSlashings} =
        calculatedBlockReward;

      // Sanity check
      expect(proposerIndex).toBe(block.message.proposerIndex);
      expect(total).toBe(attestations + syncAggregate + proposerSlashings + attesterSlashings);
      if (opts.syncCommitteeBitsLen === 0) {
        expect(syncAggregate).toBe(0);
      }
      if (opts.attestationLen === 0) {
        expect(attestations).toBe(0);
      }
      if (opts.proposerSlashingLen === 0) {
        expect(proposerSlashings).toBe(0);
      }
      if (opts.attesterSlashingLen === 0) {
        expect(attesterSlashings).toBe(0);
      }

      const postState = stateTransition(state as CachedBeaconStateAllForks, block, {
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        dataAvailableStatus: DataAvailableStatus.available,
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      });

      // Cross check with rewardCache
      const rewardCache = postState.proposerRewards;
      expect(total).toBe(rewardCache.attestations + rewardCache.syncAggregate + rewardCache.slashing);
      expect(attestations).toBe(rewardCache.attestations);
      expect(syncAggregate).toBe(rewardCache.syncAggregate);
      expect(proposerSlashings + attesterSlashings).toBe(rewardCache.slashing);
    });
  }

  // Check if `computeBlockRewards` consults reward cache in the post state first
  it("Check reward cache", async () => {
    const preState = generatePerfTestCachedStateAltair();
    const {opts} = testCases[0]; // Use opts of `normal case`
    const block = getBlockAltair(preState, testCases[0].opts);
    // Populate permanent root caches of the block
    ssz.altair.BeaconBlock.hashTreeRoot(block.message);
    // Populate tree root caches of the state
    preState.hashTreeRoot();
    cachedStateAltairPopulateCaches(preState);

    const postState = stateTransition(preState as CachedBeaconStateAllForks, block, {
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      dataAvailableStatus: DataAvailableStatus.available,
      verifyProposer: false,
      verifySignatures: false,
      verifyStateRoot: false,
    });

    // Set postState's reward cache
    const rewardCache = postState.proposerRewards; // Grab original reward cache before overwritten
    postState.proposerRewards = {attestations: 1000, syncAggregate: 1001, slashing: 1002};

    const calculatedBlockReward = await computeBlockRewards(
      block.message,
      preState as CachedBeaconStateAllForks,
      postState
    );
    const {proposerIndex, total, attestations, syncAggregate, proposerSlashings, attesterSlashings} =
      calculatedBlockReward;

    expect(proposerIndex).toBe(block.message.proposerIndex);
    expect(total).toBe(attestations + syncAggregate + proposerSlashings + attesterSlashings);
    if (opts.syncCommitteeBitsLen === 0) {
      expect(syncAggregate).toBe(0);
    }
    if (opts.attestationLen === 0) {
      expect(attestations).toBe(0);
    }
    if (opts.proposerSlashingLen === 0) {
      expect(proposerSlashings).toBe(0);
    }
    if (opts.attesterSlashingLen === 0) {
      expect(attesterSlashings).toBe(0);
    }

    // Cross check with rewardCache
    expect(attestations).toBe(1000);
    expect(syncAggregate).toBe(1001);
    expect(proposerSlashings + attesterSlashings).not.toBe(1002);
    expect(proposerSlashings + attesterSlashings).toBe(rewardCache.slashing);
  });
});
