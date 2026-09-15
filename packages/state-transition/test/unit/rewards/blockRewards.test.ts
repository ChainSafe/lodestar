import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/block/externalData.js";
import {computeBlockRewards} from "../../../src/rewards/blockRewards.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {cachedStateAltairPopulateCaches, generatePerfTestCachedStateAltair} from "../../../src/testUtils/util.js";
import {CachedBeaconStateAllForks} from "../../../src/types.js";
import {BlockAltairOpts, getBlockAltair} from "../../perf/block/util.js";

describe("chain / rewards / blockRewards", () => {
  const config = createBeaconConfig({...chainConfigDef, ALTAIR_FORK_EPOCH: 0}, Buffer.alloc(32, 0xaa));
  const validatorCount = 8192;
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
      const state = generatePerfTestCachedStateAltair({vc: validatorCount, goBackOneSlot: false});
      const block = getBlockAltair(state, opts);
      // Populate permanent root caches of the block
      ssz.altair.BeaconBlock.hashTreeRoot(block.message);
      // Populate tree root caches of the state
      state.hashTreeRoot();
      cachedStateAltairPopulateCaches(state);
      const calculatedBlockReward = await computeBlockRewards(
        config,
        block.message,
        state as CachedBeaconStateAllForks
      );
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

      const postState = new BeaconStateView(state as CachedBeaconStateAllForks).stateTransition(
        state.config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block),
        block,
        {
          executionPayloadStatus: ExecutionPayloadStatus.valid,
          dataAvailabilityStatus: DataAvailabilityStatus.Available,
          verifyProposer: false,
          verifySignatures: false,
          verifyStateRoot: false,
        },
        {}
      );

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
    const preState = generatePerfTestCachedStateAltair({vc: validatorCount, goBackOneSlot: false});
    const {opts} = testCases[0]; // Use opts of `normal case`
    const block = getBlockAltair(preState, testCases[0].opts);
    // Populate permanent root caches of the block
    ssz.altair.BeaconBlock.hashTreeRoot(block.message);
    // Populate tree root caches of the state
    preState.hashTreeRoot();
    cachedStateAltairPopulateCaches(preState);

    const postState = new BeaconStateView(preState as CachedBeaconStateAllForks).stateTransition(
      config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block),
      block,
      {
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        dataAvailabilityStatus: DataAvailabilityStatus.Available,
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      },
      {}
    );

    // Set postState's reward cache
    const rewardCache = postState.proposerRewards; // Grab original reward cache before overwritten
    const proposerRewards = {attestations: 1000, syncAggregate: 1001, slashing: 1002};

    const calculatedBlockReward = await computeBlockRewards(
      config,
      block.message,
      preState as CachedBeaconStateAllForks,
      proposerRewards
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
