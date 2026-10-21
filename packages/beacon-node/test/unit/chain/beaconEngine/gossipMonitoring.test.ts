import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {computeSignedBlockRoot} from "../../../../src/chain/blocks/signedBlockRoot.js";
import {
  AttestationError,
  AttestationErrorCode,
  BlockErrorCode,
  BlockGossipError,
  GossipAction,
} from "../../../../src/chain/errors/index.js";
import {AttestationPool} from "../../../../src/chain/opPools/attestationPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import * as aggregateValidation from "../../../../src/chain/validation/aggregateAndProof.js";
import * as attestationValidation from "../../../../src/chain/validation/attestation.js";
import * as blockValidation from "../../../../src/chain/validation/block.js";
import * as bidValidation from "../../../../src/chain/validation/executionPayloadBid.js";
import * as contributionValidation from "../../../../src/chain/validation/syncCommitteeContributionAndProof.js";
import {OpSource, ValidatorMonitor, createValidatorMonitor} from "../../../../src/chain/validatorMonitor.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {getApiTestModules} from "../../../utils/api.js";

describe("BeaconEngineCore gossip monitoring", () => {
  let engine: BeaconEngineCore;
  let monitor: ValidatorMonitor;

  beforeEach(async () => {
    vi.useFakeTimers();
    const modules = getApiTestModules();
    engine = new BeaconEngineCore({
      serializedCache: new SerializedCache({cacheDeserialized: true}),
      config: modules.chain.config,
      opts: {...defaultChainOptions},
      logging: {type: "injected", logger: modules.logger},
      metricsEnabled: false,
      genesisTime: modules.chain.clock.genesisTime,
      clock: modules.chain.clock,
      db: modules.db,
      dbName: "test",
      dataDir: "test",
      dataColumnDir: "test",
      cpStateDatastore: {write: vi.fn(), remove: vi.fn(), read: vi.fn(), readLatestSafe: vi.fn(), readKeys: vi.fn()},
      validatorMonitorOpts: null,
      isAnchorStateFinalized: true,
      executionEngine: new ExecutionEngineDisabled(),
    });
    await engine.init();
    engine.forkChoice = modules.chain.forkChoice;
    engine.attestationPool = new AttestationPool(modules.config, engine.clock);
    engine.aggregatedAttestationPool = modules.chain.aggregatedAttestationPool;
    engine.aggregatedAttestationPool.add = vi.fn().mockReturnValue(InsertOutcome.NewData);
    engine.syncContributionAndProofPool = modules.chain.syncContributionAndProofPool;
    engine.syncContributionAndProofPool.add = vi.fn().mockReturnValue(InsertOutcome.NewData);
    vi.spyOn(engine.executionPayloadBidPool, "add").mockReturnValue(InsertOutcome.NewData);
    monitor = createValidatorMonitor(null, modules.config, 0, modules.logger, {});
    engine.validatorMonitor = monitor;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["accept", "sibling", "unobserved_sibling", "unknown_parent", "unknown_payload", "reject"])(
    "preserves block observation eligibility and timing for %s",
    async (scenario) => {
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = 1;
      const validate = vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
      vi.spyOn(engine.seenBlockProposers, "hasBlockRoot").mockReturnValue(scenario === "sibling");
      const observed = vi.spyOn(monitor, "registerBeaconBlock").mockImplementation(() => {});
      if (scenario === "sibling" || scenario === "unobserved_sibling") {
        validate.mockRejectedValue(
          new BlockGossipError(GossipAction.IGNORE, {
            code: BlockErrorCode.REPEAT_PROPOSAL,
            proposerIndex: block.message.proposerIndex,
            root: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)),
          })
        );
      } else if (scenario === "unknown_parent") {
        validate.mockRejectedValue(
          new BlockGossipError(GossipAction.IGNORE, {
            code: BlockErrorCode.PARENT_BLOCK_UNKNOWN,
            parentRoot: toRootHex(block.message.parentRoot),
          })
        );
      } else if (scenario === "unknown_payload") {
        validate.mockRejectedValue(
          new BlockGossipError(GossipAction.IGNORE, {
            code: BlockErrorCode.PARENT_PAYLOAD_UNKNOWN,
            parentRoot: toRootHex(block.message.parentRoot),
            parentBlockHash: toRootHex(Buffer.alloc(32)),
          })
        );
      } else if (scenario === "reject") {
        validate.mockRejectedValue(
          new BlockGossipError(GossipAction.REJECT, {
            code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
            slot: 1,
            root: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)),
          })
        );
      }

      const result = await engine.validateGossipBlock(
        computeSignedBlockRoot(ForkName.phase0, block),
        ssz.phase0.SignedBeaconBlock.serialize(block),
        ForkName.phase0,
        12.5
      );
      expect(result.err?.status ?? "accept").toBe(
        scenario === "accept" ? "accept" : scenario === "reject" ? "reject" : "ignore"
      );
      expect(observed).toHaveBeenCalledTimes(scenario === "sibling" ? 1 : 0);
      await vi.runAllTimersAsync();
      expect(observed).toHaveBeenCalledTimes(scenario === "accept" || scenario === "sibling" ? 1 : 0);
      if (observed.mock.calls.length > 0) {
        expect(observed).toHaveBeenCalledWith(OpSource.gossip, engine.clock.secFromSlot(1, 12.5), {
          slot: 1,
          proposerIndex: block.message.proposerIndex,
          blockRoot: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)),
        });
      }
    }
  );

  it("does not count API use of the block validator as gossip reception", async () => {
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    const observed = vi.spyOn(monitor, "registerBeaconBlock");
    const result = await engine.validateGossipBlock(
      computeSignedBlockRoot(ForkName.phase0, ssz.phase0.SignedBeaconBlock.defaultValue()),
      ssz.phase0.SignedBeaconBlock.serialize(ssz.phase0.SignedBeaconBlock.defaultValue()),
      ForkName.phase0
    );
    await vi.runAllTimersAsync();
    expect(result.err).toBeNull();
    expect(observed).not.toHaveBeenCalled();
  });

  it("skips deferred block monitoring when the engine closes after validation", async () => {
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    const observed = vi.spyOn(monitor, "registerBeaconBlock");
    const result = await engine.validateGossipBlock(
      computeSignedBlockRoot(ForkName.phase0, ssz.phase0.SignedBeaconBlock.defaultValue()),
      ssz.phase0.SignedBeaconBlock.serialize(ssz.phase0.SignedBeaconBlock.defaultValue()),
      ForkName.phase0,
      1
    );

    expect(result.err).toBeNull();
    expect(observed).not.toHaveBeenCalled();
    await engine.close();
    await vi.runAllTimersAsync();
    expect(observed).not.toHaveBeenCalled();
  });

  it("isolates block monitor failures from the accepted verdict", async () => {
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    vi.spyOn(monitor, "registerBeaconBlock").mockImplementation(() => {
      throw new Error("monitor failed");
    });
    const result = await engine.validateGossipBlock(
      computeSignedBlockRoot(ForkName.phase0, ssz.phase0.SignedBeaconBlock.defaultValue()),
      ssz.phase0.SignedBeaconBlock.serialize(ssz.phase0.SignedBeaconBlock.defaultValue()),
      ForkName.phase0,
      1
    );
    await vi.runAllTimersAsync();
    expect(result.err).toBeNull();
    expect(engine.logger.debug).toHaveBeenCalledWith(
      "Error monitoring gossip block",
      expect.anything(),
      expect.any(Error)
    );
  });

  it("observes accepted batch objects once, after verdicts, with original receipt times", async () => {
    const indexedAttestation = ssz.electra.IndexedAttestation.defaultValue();
    const value: attestationValidation.AttestationValidationResult = {
      attestation: ssz.electra.SingleAttestation.defaultValue(),
      indexedAttestation,
      subnet: 0,
      attDataRootHex: toRootHex(Buffer.alloc(32)),
      committeeIndex: 0,
      validatorCommitteeIndex: 0,
      committeeSize: 64,
    };
    const ignored = new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.FUTURE_SLOT,
      attestationSlot: 1,
      latestPermissibleSlot: 0,
    });
    const rejected = new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE});
    vi.spyOn(attestationValidation, "validateGossipAttestationsSameAttData").mockResolvedValue({
      results: [{err: null, result: value}, {err: ignored}, {err: rejected}, {err: null, result: value}],
      batchableBls: true,
    });
    const observed = vi.spyOn(monitor, "registerGossipUnaggregatedAttestation").mockImplementationOnce(() => {
      throw new Error("monitor failed");
    });
    const inputs = Array.from({length: 4}, () => ({
      attestation: null,
      serializedData: new Uint8Array(),
      attSlot: 0,
      attDataBase64: "test",
      subnet: 0,
    }));
    const {results} = await engine.validateGossipAttestationsSameAttData(ForkName.electra, inputs, [1, 2, 3, 4]);
    expect(results.map(({err}) => err?.status ?? "accept")).toEqual(["accept", "ignore", "reject", "accept"]);
    expect(observed).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(observed).toHaveBeenCalledTimes(2);
    expect(observed).toHaveBeenNthCalledWith(1, 1, indexedAttestation);
    expect(observed).toHaveBeenNthCalledWith(2, 4, indexedAttestation);
    expect(observed.mock.calls[0][1]).toBe(indexedAttestation);
  });

  it("reuses validated aggregate and contribution objects in deferred monitoring", async () => {
    const aggregate = ssz.electra.SignedAggregateAndProof.defaultValue();
    const indexedAttestation = ssz.electra.IndexedAttestation.defaultValue();
    const contribution = ssz.altair.SignedContributionAndProof.defaultValue();
    const participants = [1, 2];
    vi.spyOn(aggregateValidation, "validateGossipAggregateAndProof").mockResolvedValue({
      indexedAttestation,
      committeeValidatorIndices: new Uint32Array(),
      attDataRootHex: toRootHex(Buffer.alloc(32)),
    });
    vi.spyOn(contributionValidation, "validateSyncCommitteeGossipContributionAndProof").mockResolvedValue({
      syncCommitteeParticipantIndices: participants,
    });
    const observedAggregate = vi.spyOn(monitor, "registerGossipAggregatedAttestation");
    const observedContribution = vi.spyOn(monitor, "registerGossipSyncContributionAndProof");
    const aggregateBytes = ssz.electra.SignedAggregateAndProof.serialize(aggregate);
    const contributionBytes = ssz.altair.SignedContributionAndProof.serialize(contribution);
    engine.serializedCache?.set(aggregate, aggregateBytes);
    engine.serializedCache?.set(contribution, contributionBytes);
    expect((await engine.validateGossipAggregateAndProof(aggregateBytes, ForkName.electra, 12.5)).err).toBeNull();
    expect((await engine.validateSyncCommitteeGossipContributionAndProof(contributionBytes)).err).toBeNull();
    expect(observedAggregate).not.toHaveBeenCalled();
    expect(observedContribution).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(observedAggregate).toHaveBeenCalledExactlyOnceWith(12.5, aggregate, indexedAttestation);
    expect(observedAggregate.mock.calls[0][1]).toBe(aggregate);
    expect(observedAggregate.mock.calls[0][2]).toBe(indexedAttestation);
    expect(observedContribution).toHaveBeenCalledExactlyOnceWith(contribution.message, participants);
    expect(observedContribution.mock.calls[0][1]).toBe(participants);
  });

  it("restores deferred bid monitoring without changing validation when the monitor fails", async () => {
    const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    vi.spyOn(bidValidation, "validateGossipExecutionPayloadBid").mockResolvedValue({proposerIndex: 7});
    const observed = vi.spyOn(monitor, "registerExecutionPayloadBid").mockImplementation(() => {
      throw new Error("monitor failed");
    });
    const result = await engine.validateGossipExecutionPayloadBid(
      ssz.gloas.SignedExecutionPayloadBid.serialize(bid),
      ForkName.gloas,
      1
    );
    expect(observed).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(result.err).toBeNull();
    expect(observed).toHaveBeenCalledExactlyOnceWith(OpSource.gossip, 7, bid.message);
  });
});
