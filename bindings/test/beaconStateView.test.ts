import {config} from "@lodestar/config/default";
import * as era from "@lodestar/era";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {type phase0, ssz} from "@lodestar/types";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import bindings from "../src/index.js";
import {getFirstEraFilePath} from "./eraFiles.ts";

const MAINNET_PUBKEY_CACHE_LIMIT = 2_000_000;
const SYNTHETIC_VALIDATOR_COUNT = 16;

function expectSyncCommitteeCache(cache: {
  validatorIndices: Uint32Array;
  validatorIndexMap: Map<number, number[]>;
}): void {
  expect(cache.validatorIndices).toBeInstanceOf(Uint32Array);
  expect(cache.validatorIndices.length).toBeGreaterThan(0);
  expect(cache.validatorIndexMap).toBeInstanceOf(Map);

  const firstValidatorIndex = cache.validatorIndices[0];
  const firstValidatorPositions = cache.validatorIndexMap.get(firstValidatorIndex);
  expect(Array.isArray(firstValidatorPositions)).toBe(true);
  expect(firstValidatorPositions).toContain(0);
}

describe("BeaconStateView", () => {
  let nativeConfig: InstanceType<typeof bindings.BeaconConfig>;
  let state: InstanceType<typeof bindings.BeaconStateView>;
  let stateBytes: Uint8Array;
  let syntheticValidators: phase0.Validator[];
  let expected: {
    slot: number;
    genesisTime: number;
    genesisValidatorsRoot: Uint8Array;
    validatorCount: number;
    fork: {previousVersion: Uint8Array; currentVersion: Uint8Array; epoch: number};
    eth1Data: {depositRoot: Uint8Array; depositCount: bigint; blockHash: Uint8Array};
    latestBlockHeader: {
      slot: number;
      proposerIndex: number;
      parentRoot: Uint8Array;
      stateRoot: Uint8Array;
      bodyRoot: Uint8Array;
    };
    previousJustifiedCheckpoint: {epoch: number; root: Uint8Array};
    currentJustifiedCheckpoint: {epoch: number; root: Uint8Array};
    finalizedCheckpoint: {epoch: number; root: Uint8Array};
    currentSyncCommittee: {aggregatePubkey: Uint8Array};
    nextSyncCommittee: {aggregatePubkey: Uint8Array};
    latestExecutionPayloadHeader: {
      blockNumber: number;
      blockHash: Uint8Array;
      parentHash: Uint8Array;
      stateRoot: Uint8Array;
      timestamp: number;
      gasLimit: number;
      gasUsed: number;
    };
    balance0: number;
    balance100: number;
    validator0: {
      pubkey: Uint8Array;
      withdrawalCredentials: Uint8Array;
      effectiveBalance: number;
      slashed: boolean;
      activationEligibilityEpoch: number;
      activationEpoch: number;
      exitEpoch: number;
      withdrawableEpoch: number;
    };
  };

  beforeAll(async () => {
    const reader = await era.era.EraReader.open(config, getFirstEraFilePath());
    try {
      stateBytes = await reader.readSerializedState();
    } finally {
      await reader.close();
    }

    // Phase 1: Build lodestar tree view and extract reference values.
    // The tree uses ~3-4GB for mainnet, so we extract what we need and free it
    // before creating the native state to avoid OOM on CI.
    {
      const lodestarState = ssz.fulu.BeaconState.deserializeToView(stateBytes);
      syntheticValidators = Array.from({length: SYNTHETIC_VALIDATOR_COUNT}, (_, index) => {
        const validator = lodestarState.validators.get(index);
        return {
          activationEligibilityEpoch: validator.activationEligibilityEpoch,
          activationEpoch: validator.activationEpoch,
          effectiveBalance: validator.effectiveBalance,
          exitEpoch: validator.exitEpoch,
          pubkey: Uint8Array.from(validator.pubkey),
          slashed: validator.slashed,
          withdrawableEpoch: validator.withdrawableEpoch,
          withdrawalCredentials: Uint8Array.from(validator.withdrawalCredentials),
        };
      });
      const v0 = syntheticValidators[0];
      expected = {
        balance0: lodestarState.balances.get(0),
        balance100: lodestarState.balances.get(100),
        currentJustifiedCheckpoint: {
          epoch: lodestarState.currentJustifiedCheckpoint.epoch,
          root: Uint8Array.from(lodestarState.currentJustifiedCheckpoint.root),
        },
        currentSyncCommittee: {
          aggregatePubkey: Uint8Array.from(lodestarState.currentSyncCommittee.aggregatePubkey),
        },
        eth1Data: {
          blockHash: Uint8Array.from(lodestarState.eth1Data.blockHash),
          depositCount: BigInt(lodestarState.eth1Data.depositCount),
          depositRoot: Uint8Array.from(lodestarState.eth1Data.depositRoot),
        },
        finalizedCheckpoint: {
          epoch: lodestarState.finalizedCheckpoint.epoch,
          root: Uint8Array.from(lodestarState.finalizedCheckpoint.root),
        },
        fork: {
          currentVersion: Uint8Array.from(lodestarState.fork.currentVersion),
          epoch: lodestarState.fork.epoch,
          previousVersion: Uint8Array.from(lodestarState.fork.previousVersion),
        },
        genesisTime: lodestarState.genesisTime,
        genesisValidatorsRoot: Uint8Array.from(lodestarState.genesisValidatorsRoot),
        latestBlockHeader: {
          bodyRoot: Uint8Array.from(lodestarState.latestBlockHeader.bodyRoot),
          parentRoot: Uint8Array.from(lodestarState.latestBlockHeader.parentRoot),
          proposerIndex: lodestarState.latestBlockHeader.proposerIndex,
          slot: lodestarState.latestBlockHeader.slot,
          stateRoot: Uint8Array.from(lodestarState.latestBlockHeader.stateRoot),
        },
        latestExecutionPayloadHeader: {
          blockHash: Uint8Array.from(lodestarState.latestExecutionPayloadHeader.blockHash),
          blockNumber: lodestarState.latestExecutionPayloadHeader.blockNumber,
          gasLimit: lodestarState.latestExecutionPayloadHeader.gasLimit,
          gasUsed: lodestarState.latestExecutionPayloadHeader.gasUsed,
          parentHash: Uint8Array.from(lodestarState.latestExecutionPayloadHeader.parentHash),
          stateRoot: Uint8Array.from(lodestarState.latestExecutionPayloadHeader.stateRoot),
          timestamp: lodestarState.latestExecutionPayloadHeader.timestamp,
        },
        nextSyncCommittee: {
          aggregatePubkey: Uint8Array.from(lodestarState.nextSyncCommittee.aggregatePubkey),
        },
        previousJustifiedCheckpoint: {
          epoch: lodestarState.previousJustifiedCheckpoint.epoch,
          root: Uint8Array.from(lodestarState.previousJustifiedCheckpoint.root),
        },
        slot: lodestarState.slot,
        validator0: v0,
        validatorCount: lodestarState.validators.length,
      };
    }
    // lodestarState is now out of scope — force GC to reclaim the ~3-4GB tree
    global.gc?.();

    // Phase 2: Create native BeaconStateView
    try {
      bindings.pubkeys.load("./mainnet.pkix", MAINNET_PUBKEY_CACHE_LIMIT);
    } catch (_e) {
      // Rebuild incompatible or corrupt snapshots from the serialized state.
      bindings.pubkeys.ensureCapacity(MAINNET_PUBKEY_CACHE_LIMIT);
    }
    nativeConfig = new bindings.BeaconConfig(config, expected.genesisValidatorsRoot);
    state = bindings.BeaconStateView.createFromBytes(stateBytes, nativeConfig);
  }, 120_000); // 2 minute timeout for loading era file

  afterAll(() => state?.release());

  describe("basic properties", () => {
    it("slot should match lodestar", () => {
      expect(state.slot).toBe(expected.slot);
    });

    it("epoch should be computed correctly from slot", () => {
      const expectedEpoch = computeEpochAtSlot(state.slot);
      expect(state.epoch).toBe(expectedEpoch);
    });

    it("genesisTime should match lodestar", () => {
      expect(state.genesisTime).toBe(expected.genesisTime);
    });

    it("genesisValidatorsRoot should match lodestar", () => {
      expect(state.genesisValidatorsRoot).toEqual(expected.genesisValidatorsRoot);
    });

    it("validatorCount should match lodestar", () => {
      expect(state.validatorCount).toBe(expected.validatorCount);
    });
  });

  describe("fork", () => {
    it("fork.previousVersion should match lodestar", () => {
      expect(state.fork.previousVersion).toEqual(expected.fork.previousVersion);
    });

    it("fork.currentVersion should match lodestar", () => {
      expect(state.fork.currentVersion).toEqual(expected.fork.currentVersion);
    });

    it("fork.epoch should match lodestar", () => {
      expect(state.fork.epoch).toBe(expected.fork.epoch);
    });
  });

  describe("eth1Data", () => {
    it("eth1Data.depositRoot should match lodestar", () => {
      expect(state.eth1Data.depositRoot).toEqual(expected.eth1Data.depositRoot);
    });

    it("eth1Data.depositCount should match lodestar", () => {
      expect(state.eth1Data.depositCount).toBe(expected.eth1Data.depositCount);
    });

    it("eth1Data.blockHash should match lodestar", () => {
      expect(state.eth1Data.blockHash).toEqual(expected.eth1Data.blockHash);
    });
  });

  describe("latestBlockHeader", () => {
    it("latestBlockHeader.slot should match lodestar", () => {
      expect(state.latestBlockHeader.slot).toBe(expected.latestBlockHeader.slot);
    });

    it("latestBlockHeader.proposerIndex should match lodestar", () => {
      expect(state.latestBlockHeader.proposerIndex).toBe(expected.latestBlockHeader.proposerIndex);
    });

    it("latestBlockHeader.parentRoot should match lodestar", () => {
      expect(state.latestBlockHeader.parentRoot).toEqual(expected.latestBlockHeader.parentRoot);
    });

    it("latestBlockHeader.stateRoot should match lodestar", () => {
      expect(state.latestBlockHeader.stateRoot).toEqual(expected.latestBlockHeader.stateRoot);
    });

    it("latestBlockHeader.bodyRoot should match lodestar", () => {
      expect(state.latestBlockHeader.bodyRoot).toEqual(expected.latestBlockHeader.bodyRoot);
    });
  });

  describe("checkpoints", () => {
    it("previousJustifiedCheckpoint should match lodestar", () => {
      expect(state.previousJustifiedCheckpoint.epoch).toBe(expected.previousJustifiedCheckpoint.epoch);
      expect(state.previousJustifiedCheckpoint.root).toEqual(expected.previousJustifiedCheckpoint.root);
    });

    it("currentJustifiedCheckpoint should match lodestar", () => {
      expect(state.currentJustifiedCheckpoint.epoch).toBe(expected.currentJustifiedCheckpoint.epoch);
      expect(state.currentJustifiedCheckpoint.root).toEqual(expected.currentJustifiedCheckpoint.root);
    });

    it("finalizedCheckpoint should match lodestar", () => {
      expect(state.finalizedCheckpoint.epoch).toBe(expected.finalizedCheckpoint.epoch);
      expect(state.finalizedCheckpoint.root).toEqual(expected.finalizedCheckpoint.root);
    });
  });

  describe("sync committees (altair+)", () => {
    it("currentSyncCommittee.aggregatePubkey should match lodestar", () => {
      expect(state.currentSyncCommittee.aggregatePubkey).toEqual(expected.currentSyncCommittee.aggregatePubkey);
    });

    it("nextSyncCommittee.aggregatePubkey should match lodestar", () => {
      expect(state.nextSyncCommittee.aggregatePubkey).toEqual(expected.nextSyncCommittee.aggregatePubkey);
    });
  });

  describe("execution payload header (bellatrix+)", () => {
    it("latestExecutionPayloadHeader.blockNumber should match lodestar", () => {
      expect(state.latestExecutionPayloadHeader.blockNumber).toBe(expected.latestExecutionPayloadHeader.blockNumber);
    });

    it("latestExecutionPayloadHeader.blockHash should match lodestar", () => {
      expect(state.latestExecutionPayloadHeader.blockHash).toEqual(expected.latestExecutionPayloadHeader.blockHash);
    });

    it("latestExecutionPayloadHeader.parentHash should match lodestar", () => {
      expect(state.latestExecutionPayloadHeader.parentHash).toEqual(expected.latestExecutionPayloadHeader.parentHash);
    });

    it("latestExecutionPayloadHeader.stateRoot should match lodestar", () => {
      expect(state.latestExecutionPayloadHeader.stateRoot).toEqual(expected.latestExecutionPayloadHeader.stateRoot);
    });

    it("latestExecutionPayloadHeader.timestamp should match lodestar", () => {
      expect(state.latestExecutionPayloadHeader.timestamp).toBe(expected.latestExecutionPayloadHeader.timestamp);
    });

    it("latestExecutionPayloadHeader.gasLimit should match lodestar", () => {
      expect(state.latestExecutionPayloadHeader.gasLimit).toBe(expected.latestExecutionPayloadHeader.gasLimit);
    });

    it("latestExecutionPayloadHeader.gasUsed should match lodestar", () => {
      expect(state.latestExecutionPayloadHeader.gasUsed).toBe(expected.latestExecutionPayloadHeader.gasUsed);
    });

    it("isMergeTransitionComplete should be true for fulu state", () => {
      expect(state.isMergeTransitionComplete).toBe(true);
    });

    it("isExecutionStateType should be true for fulu state", () => {
      expect(state.isExecutionStateType).toBe(true);
    });
  });

  describe("isExecutionEnabled", () => {
    let phase0View: InstanceType<typeof bindings.BeaconStateView>;
    let bellatrixView: InstanceType<typeof bindings.BeaconStateView>;

    beforeAll(() => {
      const syncCommittee = {
        aggregatePubkey: syntheticValidators[0].pubkey,
        pubkeys: Array.from({length: 512}, (_, index) => syntheticValidators[index % SYNTHETIC_VALIDATOR_COUNT].pubkey),
      };
      const bellatrixState = ssz.bellatrix.BeaconState.defaultValue();
      bellatrixState.slot = 144896 * 32;
      bellatrixState.validators = syntheticValidators;
      bellatrixState.currentSyncCommittee = syncCommittee;
      bellatrixState.nextSyncCommittee = syncCommittee;
      bellatrixState.previousEpochParticipation = Array.from({length: SYNTHETIC_VALIDATOR_COUNT}, () => 0);
      bellatrixState.currentEpochParticipation = Array.from({length: SYNTHETIC_VALIDATOR_COUNT}, () => 0);

      phase0View = bindings.BeaconStateView.createFromBytes(
        ssz.phase0.BeaconState.serialize(ssz.phase0.BeaconState.defaultValue()),
        nativeConfig
      );
      bellatrixView = bindings.BeaconStateView.createFromBytes(
        ssz.bellatrix.BeaconState.serialize(bellatrixState),
        nativeConfig
      );
    });

    afterAll(() => {
      phase0View?.release();
      bellatrixView?.release();
    });

    it("should true on post-merge state without reading the block", () => {
      // body is empty — binding short-circuits before touching it.
      expect(state.isExecutionEnabled({body: {}})).toBe(true);
    });

    it("returns false even when block carries a non-default executionPayload", () => {
      const payload = ssz.bellatrix.ExecutionPayload.defaultValue();
      payload.blockNumber = 1;
      expect(phase0View.isExecutionEnabled({body: {executionPayload: payload}})).toBe(false);
    });

    it("returns true after walking block for non-default payload", () => {
      const payload = ssz.bellatrix.ExecutionPayload.defaultValue();
      payload.blockNumber = 1;
      expect(bellatrixView.isExecutionEnabled({body: {executionPayload: payload}})).toBe(true);
    });

    it("returns false when block is blinded (body has executionPayloadHeader)", () => {
      // Lodestar treats blinded pre-merge Bellatrix blocks as not-yet-merged because the
      // state header is still default. The Zig short-circuits on the presence of the field.
      expect(bellatrixView.isExecutionEnabled({body: {executionPayloadHeader: {}}})).toBe(false);
    });
  });

  describe("validators and balances", () => {
    it("getBalance(0) should return first validator balance", () => {
      expect(state.getBalance(0)).toBe(expected.balance0);
    });

    it("getBalance(100) should return validator 100 balance", () => {
      expect(state.getBalance(100)).toBe(expected.balance100);
    });

    it("getValidator(0) should return first validator data", () => {
      const validator = state.getValidator(0);

      expect(validator.pubkey).toEqual(expected.validator0.pubkey);
      expect(validator.withdrawalCredentials).toEqual(expected.validator0.withdrawalCredentials);
      expect(validator.effectiveBalance).toBe(expected.validator0.effectiveBalance);
      expect(validator.slashed).toBe(expected.validator0.slashed);
      expect(validator.activationEligibilityEpoch).toBe(expected.validator0.activationEligibilityEpoch);
      expect(validator.activationEpoch).toBe(expected.validator0.activationEpoch);
      expect(validator.exitEpoch).toBe(expected.validator0.exitEpoch);
      expect(validator.withdrawableEpoch).toBe(expected.validator0.withdrawableEpoch);
    });

    it("getValidatorStatus should return a valid status string", () => {
      const status = state.getValidatorStatus(0);
      const validStatuses = [
        "pending_initialized",
        "pending_queued",
        "active_ongoing",
        "active_exiting",
        "active_slashed",
        "exited_unslashed",
        "exited_slashed",
        "withdrawal_possible",
        "withdrawal_done",
      ];
      expect(validStatuses).toContain(status);
    });

    it("activeValidatorCount should be positive", () => {
      expect(state.activeValidatorCount).toBeGreaterThan(0);
    });

    it("effectiveBalanceIncrements should have correct length", () => {
      expect(state.effectiveBalanceIncrements.length).toBe(state.validatorCount);
    });
  });

  describe("participation (altair+)", () => {
    it("previousEpochParticipation should have correct length", () => {
      expect(state.previousEpochParticipation.length).toBe(state.validatorCount);
    });

    it("currentEpochParticipation should have correct length", () => {
      expect(state.currentEpochParticipation.length).toBe(state.validatorCount);
    });
  });

  describe("electra+ fields", () => {
    it("pendingDepositsCount should be a non-negative number", () => {
      expect(state.pendingDepositsCount).toBeGreaterThanOrEqual(0);
    });

    it("pendingPartialWithdrawalsCount should be a non-negative number", () => {
      expect(state.pendingPartialWithdrawalsCount).toBeGreaterThanOrEqual(0);
    });

    it("pendingConsolidationsCount should be a non-negative number", () => {
      expect(state.pendingConsolidationsCount).toBeGreaterThanOrEqual(0);
    });

    it("historicalSummaries should be an array", () => {
      expect(Array.isArray(state.historicalSummaries)).toBe(true);
    });
  });

  describe("fulu+ fields", () => {
    it("proposerLookahead should be a Uint32Array", () => {
      expect(state.proposerLookahead).toBeInstanceOf(Uint32Array);
    });
  });

  describe("gloas+ fields", () => {
    it("getBuildersLength should throw on a pre-Gloas state", () => {
      expect(() => state.getBuildersLength()).toThrow();
    });
  });

  describe("block and state roots", () => {
    it("getBlockRoot should return 32 bytes", () => {
      const blockRoot = state.getBlockRoot(state.epoch - 1);
      expect(blockRoot.length).toBe(32);
    });

    it("getRandaoMix should return 32 bytes", () => {
      const randaoMix = state.getRandaoMix(state.epoch);
      expect(randaoMix.length).toBe(32);
    });
  });

  describe("proposers and shuffling", () => {
    it("currentProposers should be an array of validator indices", () => {
      const proposers = state.currentProposers;
      expect(Array.isArray(proposers)).toBe(true);
      expect(proposers.length).toBeGreaterThan(0);
      // Each proposer index should be a valid validator index
      for (const proposer of proposers) {
        expect(proposer).toBeGreaterThanOrEqual(0);
        expect(proposer).toBeLessThan(state.validatorCount);
      }
    });

    it("nextProposers should be an array of validator indices", () => {
      const proposers = state.nextProposers;
      expect(Array.isArray(proposers)).toBe(true);
      expect(proposers.length).toBeGreaterThan(0);
    });

    it("getBeaconProposer should return a valid validator index", () => {
      const proposer = state.getBeaconProposer(state.slot);
      expect(proposer).toBeGreaterThanOrEqual(0);
      expect(proposer).toBeLessThan(state.validatorCount);
    });

    it("decision roots should be 66 bytes each", () => {
      expect(state.previousDecisionRoot.length).toBe(66);
      expect(state.currentDecisionRoot.length).toBe(66);
      expect(state.nextDecisionRoot.length).toBe(66);
    });

    it("getShufflingDecisionRoot should return 66 bytes", () => {
      const decisionRoot = state.getShufflingDecisionRoot(state.epoch);
      expect(decisionRoot.length).toBe(66);
    });
  });

  describe("sync committee cache", () => {
    it("currentSyncCommitteeIndexed should return cache", () => {
      expectSyncCommitteeCache(state.currentSyncCommitteeIndexed);
    });

    it("getIndexedSyncCommitteeAtEpoch should return cache", () => {
      expectSyncCommitteeCache(state.getIndexedSyncCommitteeAtEpoch(state.epoch));
    });

    it("getIndexedSyncCommittee should return cache", () => {
      expectSyncCommitteeCache(state.getIndexedSyncCommittee(state.slot));
    });

    it("syncProposerReward should be a non-negative number", () => {
      expect(state.syncProposerReward).toBeGreaterThanOrEqual(0);
    });
  });

  describe("serialization", () => {
    it("release should release state and be idempotent", () => {
      const releasable = bindings.BeaconStateView.createFromBytes(
        ssz.phase0.BeaconState.serialize(ssz.phase0.BeaconState.defaultValue()),
        nativeConfig
      );

      releasable.release();

      expect(() => releasable.slot).toThrow("InvalidState");
      expect(() => releasable.release()).not.toThrow();
    });

    it("serialize should produce bytes matching original", () => {
      const serialized = state.serialize();
      expect(serialized.length).toBe(stateBytes.length);
      expect(Buffer.compare(serialized, stateBytes)).toBe(0);
    });

    it("serializedSize should match actual serialized length", () => {
      const size = state.serializedSize();
      const serialized = state.serialize();
      expect(size).toBe(serialized.length);
    });

    it("serializeToBytes should write correct bytes", () => {
      const size = state.serializedSize();
      const output = new Uint8Array(size);
      const byteViews = {dataView: new DataView(output.buffer), uint8Array: output};
      const bytesWritten = state.serializeToBytes(byteViews, 0);

      expect(bytesWritten).toBe(size);
      expect(Buffer.compare(output, stateBytes)).toBe(0);
    });

    it("serializeValidators should produce valid validator bytes", () => {
      const validatorsBytes = state.serializeValidators();
      // Each validator is 121 bytes in SSZ
      expect(validatorsBytes.length).toBe(state.validatorCount * 121);
    });

    it("serializedValidatorsSize should match validators byte length", () => {
      const size = state.serializedValidatorsSize();
      expect(size).toBe(state.validatorCount * 121);
    });

    it("serializeValidatorsToBytes should write correct bytes", () => {
      const size = state.serializedValidatorsSize();
      const output = new Uint8Array(size);
      const byteViews = {dataView: new DataView(output.buffer), uint8Array: output};
      const bytesWritten = state.serializeValidatorsToBytes(byteViews, 0);

      expect(bytesWritten).toBe(size);

      const expectedValidators = state.serializeValidators();
      expect(Buffer.compare(output, expectedValidators)).toBe(0);
    });
  }, 10_000); // slow

  /*TODO: This tests passes locally on a long timeout but the worker crashes on GitHub CI.
  / It is also unusual that this takes as long as it does when demo.ts runs nearly instantly.
   Investigate and fix! */
  // describe("hashTreeRoot", () => {
  //   it("hashTreeRoot should match lodestar", () => {
  //     const bindingsRoot = state.hashTreeRoot();
  //     const lodestarRoot = lodestarState.hashTreeRoot();

  //     expect(bindingsRoot).toEqual(lodestarRoot);
  //   }, 120_000); // slow
  // });

  describe("proofs", () => {
    it("getSingleProof accepts the SSZ bigint gindex for historical summaries", () => {
      const {gindex} = ssz.fulu.BeaconState.getPathInfo(["historicalSummaries"]);
      const proof = state.getSingleProof(gindex);
      expect(proof.length).toBe(gindex.toString(2).length - 1);
      for (const node of proof) {
        expect(node).toBeInstanceOf(Uint8Array);
        expect(node.length).toBe(32);
      }
      expect(state.getSingleProof(1n)).toEqual([]);
    });

    it("getSingleProof rejects invalid bigint indices without truncating them", () => {
      expect(() => state.getSingleProof(0n)).toThrowError(expect.objectContaining({code: "STATE_ERROR"}));
      for (const gindex of [-1n, (1n << 64n) + 1n]) {
        expect(() => state.getSingleProof(gindex)).toThrowError(expect.objectContaining({code: "InvalidGindex"}));
      }
    });

    it("getFinalizedRootProof should return array of 32-byte nodes", () => {
      const proof = state.getFinalizedRootProof();
      expect(Array.isArray(proof)).toBe(true);
      for (const node of proof) {
        expect(node.length).toBe(32);
      }
    });

    it("createMultiProof should return valid compact multi proof", () => {
      // Descriptor for gindex 42
      const descriptor = Uint8Array.from([0x25, 0xe0]);
      const proof = state.createMultiProof(descriptor);

      expect(proof.type).toBe("compactMulti");
      expect(Array.isArray(proof.leaves)).toBe(true);
      expect(proof.descriptor).toBeInstanceOf(Uint8Array);
    });
  });

  describe("voluntary exit validation", () => {
    it("isValidVoluntaryExit should return boolean", () => {
      const invalidExit = {
        message: {epoch: 0, validatorIndex: 0},
        signature: new Uint8Array(96),
      };
      const result = state.isValidVoluntaryExit(invalidExit, false);
      expect(typeof result).toBe("boolean");
    });

    it("getVoluntaryExitValidity should return validity reason", () => {
      const invalidExit = {
        message: {epoch: 0, validatorIndex: 0},
        signature: new Uint8Array(96),
      };
      const result = state.getVoluntaryExitValidity(invalidExit, false);

      const validReasons = [
        "valid",
        "inactive",
        "already_exited",
        "early_epoch",
        "short_time_active",
        "pending_withdrawals",
        "invalid_signature",
      ];
      expect(validReasons).toContain(result);
    });
  });

  describe("unrealized checkpoints", () => {
    it("computeUnrealizedCheckpoints should return checkpoints", () => {
      const result = state.computeUnrealizedCheckpoints();

      expect(result.justifiedCheckpoint).toBeDefined();
      expect(typeof result.justifiedCheckpoint.epoch).toBe("number");
      expect(result.justifiedCheckpoint.root.length).toBe(32);

      expect(result.finalizedCheckpoint).toBeDefined();
      expect(typeof result.finalizedCheckpoint.epoch).toBe("number");
      expect(result.finalizedCheckpoint.root.length).toBe(32);
    });
  });

  describe("proposer rewards", () => {
    it("proposerRewards should have expected structure", () => {
      const rewards = state.proposerRewards;

      expect(typeof rewards.attestations).toBe("number");
      expect(typeof rewards.syncAggregate).toBe("number");
      expect(typeof rewards.slashing).toBe("number");
    });
  });

  describe("clone tracking", () => {
    it("clonedCount should be a non-negative number", () => {
      expect(state.clonedCount).toBeGreaterThanOrEqual(0);
    });

    it("clonedCountWithTransferCache should be a non-negative number", () => {
      expect(state.clonedCountWithTransferCache).toBeGreaterThanOrEqual(0);
    });

    it("createdWithTransferCache should be a boolean", () => {
      expect(typeof state.createdWithTransferCache).toBe("boolean");
    });
  });

  describe("processSlots", () => {
    it("processSlots should advance state by 1 slot", () => {
      const originalSlot = state.slot;
      const newState = state.processSlots(originalSlot + 1);
      try {
        expect(newState.slot).toBe(originalSlot + 1);
      } finally {
        newState.release();
      }
    });

    it("processSlots with dontTransferCache: false should still transfer cache", () => {
      const originalSlot = state.slot;
      const newState = state.processSlots(originalSlot + 1, {dontTransferCache: false});
      try {
        expect(newState.slot).toBe(originalSlot + 1);
        expect(newState.createdWithTransferCache).toBe(true);
      } finally {
        newState.release();
      }
    });
  });

  describe("stateTransition", () => {
    const dummyBlockBytes = new Uint8Array(0);

    it("deserializes a blinded block with the selected block type", () => {
      const signedBlock = ssz.fulu.SignedBlindedBeaconBlock.defaultValue();
      signedBlock.message.slot = state.slot + 1;
      signedBlock.message.proposerIndex = state.getBeaconProposer(signedBlock.message.slot);
      const signedBlockBytes = ssz.fulu.SignedBlindedBeaconBlock.serialize(signedBlock);

      expect(() =>
        state.stateTransition(signedBlockBytes, true, {
          verifyProposer: false,
          verifySignatures: false,
          verifyStateRoot: false,
        })
      ).toThrow("BlockParentRootMismatch");
    });

    it("rejects invalid opts", () => {
      const invalidOpts = [
        {executionPayloadStatus: "syncing"},
        {dataAvailabilityStatus: "Whatever"},
        {executionPayloadStatus: "Valid"}, // TS enum value is "valid"
        {dataAvailabilityStatus: "available"}, // TS enum value is "Available"
      ];
      for (const opts of invalidOpts) {
        expect(() => state.stateTransition(dummyBlockBytes, false, opts)).toThrow();
      }
      expect(() => state.stateTransition(dummyBlockBytes, false, {source: "unknown"})).toThrow(
        "InvalidProcessBlockSource"
      );
    });

    // TODO: remove once Zig models DataAvailabilityStatus.NotRequired
    it("rejects gloas-only NotRequired", () => {
      expect(() => state.stateTransition(dummyBlockBytes, false, {dataAvailabilityStatus: "NotRequired"})).toThrow();
    });
  });

  describe("effective balance increments", () => {
    it("getEffectiveBalanceIncrementsZeroInactive should return Uint16Array", () => {
      const increments = state.getEffectiveBalanceIncrementsZeroInactive();
      expect(increments).toBeInstanceOf(Uint16Array);
      expect(increments.length).toBe(state.validatorCount);
    });
  });
});
