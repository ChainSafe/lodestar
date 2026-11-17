import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {GossipAction, GossipActionError} from "../../../../src/chain/errors/gossipValidation.js";
import {IBeaconEngine} from "../../../../src/chain/interface.js";
import {InclusionListInsertOutcome} from "../../../../src/chain/opPools/inclusionListStore.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import * as aggregateValidation from "../../../../src/chain/validation/aggregateAndProof.js";
import * as attesterSlashingValidation from "../../../../src/chain/validation/attesterSlashing.js";
import * as blsChangeValidation from "../../../../src/chain/validation/blsToExecutionChange.js";
import * as bidValidation from "../../../../src/chain/validation/executionPayloadBid.js";
import * as inclusionListValidation from "../../../../src/chain/validation/inclusionList.js";
import * as payloadAttestationValidation from "../../../../src/chain/validation/payloadAttestationMessage.js";
import * as proposerSlashingValidation from "../../../../src/chain/validation/proposerSlashing.js";
import * as contributionValidation from "../../../../src/chain/validation/syncCommitteeContributionAndProof.js";
import * as exitValidation from "../../../../src/chain/validation/voluntaryExit.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedState} from "../../../utils/state.js";

describe.each([BeaconEngineMode.MainThread, BeaconEngineMode.Worker])(
  "deferred gossip handling (beaconEngineMode=%s)",
  (beaconEngineMode) => {
    let engine: BeaconEngineCore;
    let facade: IBeaconEngine;

    beforeEach(() => {
      vi.useFakeTimers();
      const chain = getMockedBeaconChain();
      chain.opts.beaconEngineMode = beaconEngineMode;
      engine = chain.beaconEngine;
      engine.aggregatedAttestationPool.add = vi.fn();
      engine.syncContributionAndProofPool.add = vi.fn();
      engine.opPool.insertAttesterSlashing = vi.fn();
      engine.opPool.insertProposerSlashing = vi.fn();
      engine.opPool.insertVoluntaryExit = vi.fn();
      engine.opPool.insertBlsToExecutionChange = vi.fn();
      engine.forkChoice.onAttestation = vi.fn();
      engine.forkChoice.onAttesterSlashing = vi.fn();
      for (const method of [
        "validateGossipAggregateAndProofBytes",
        "validateSyncCommitteeGossipContributionAndProofBytes",
        "validateGossipAttesterSlashingBytes",
        "validateGossipProposerSlashingBytes",
        "validateGossipVoluntaryExitBytes",
        "validateGossipBlsToExecutionChangeBytes",
        "validateGossipPayloadAttestationMessageBytes",
        "validateGossipExecutionPayloadBidBytes",
        "validateGossipInclusionListBytes",
      ] as const) {
        Object.defineProperty(engine, method, {value: BeaconEngineCore.prototype[method], configurable: true});
      }
      facade = withBeaconEngineFacade(chain).beaconEngine;
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const cases = [
      {
        name: "aggregate",
        setup: () => {
          const value = ssz.electra.SignedAggregateAndProof.defaultValue();
          return {
            validate: vi.spyOn(aggregateValidation, "validateGossipAggregateAndProof").mockResolvedValue({
              indexedAttestation: ssz.electra.IndexedAttestation.defaultValue(),
              committeeValidatorIndices: new Uint32Array(),
              attDataRootHex: toRootHex(Buffer.alloc(32)),
            }),
            insert: vi.spyOn(engine.aggregatedAttestationPool, "add").mockReturnValue(InsertOutcome.NewData),
            invoke: () =>
              facade.validateGossipAggregateAndProof(
                ssz.electra.SignedAggregateAndProof.serialize(value),
                value,
                ForkName.electra,
                1
              ),
          };
        },
      },
      {
        name: "sync contribution",
        setup: () => {
          const value = ssz.altair.SignedContributionAndProof.defaultValue();
          return {
            validate: vi
              .spyOn(contributionValidation, "validateSyncCommitteeGossipContributionAndProof")
              .mockResolvedValue({syncCommitteeParticipantIndices: [1, 4]}),
            insert: vi.spyOn(engine.syncContributionAndProofPool, "add").mockReturnValue(InsertOutcome.NewData),
            invoke: () =>
              facade.validateSyncCommitteeGossipContributionAndProof(
                ssz.altair.SignedContributionAndProof.serialize(value),
                value
              ),
          };
        },
      },
      {
        name: "attester slashing",
        setup: () => {
          const value = ssz.electra.AttesterSlashing.defaultValue();
          return {
            validate: vi
              .spyOn(attesterSlashingValidation, "validateGossipAttesterSlashing")
              .mockResolvedValue([Buffer.alloc(32), Buffer.alloc(32)]),
            insert: vi.spyOn(engine.opPool, "insertAttesterSlashing").mockImplementation(() => {}),
            invoke: () =>
              facade.validateGossipAttesterSlashing(
                ssz.electra.AttesterSlashing.serialize(value),
                value,
                ForkName.electra
              ),
          };
        },
      },
      {
        name: "proposer slashing",
        setup: () => {
          const value = ssz.phase0.ProposerSlashing.defaultValue();
          return {
            validate: vi
              .spyOn(proposerSlashingValidation, "validateGossipProposerSlashing")
              .mockResolvedValue(Buffer.alloc(32)),
            insert: vi.spyOn(engine.opPool, "insertProposerSlashing").mockImplementation(() => {}),
            invoke: () => facade.validateGossipProposerSlashing(ssz.phase0.ProposerSlashing.serialize(value), value),
          };
        },
      },
      {
        name: "voluntary exit",
        setup: () => {
          const value = ssz.phase0.SignedVoluntaryExit.defaultValue();
          return {
            validate: vi.spyOn(exitValidation, "validateGossipVoluntaryExit").mockResolvedValue(undefined),
            insert: vi.spyOn(engine.opPool, "insertVoluntaryExit").mockImplementation(() => {}),
            invoke: () => facade.validateGossipVoluntaryExit(ssz.phase0.SignedVoluntaryExit.serialize(value), value),
          };
        },
      },
      {
        name: "BLS to execution change",
        setup: () => {
          const value = ssz.capella.SignedBLSToExecutionChange.defaultValue();
          return {
            validate: vi.spyOn(blsChangeValidation, "validateGossipBlsToExecutionChange").mockResolvedValue(undefined),
            insert: vi.spyOn(engine.opPool, "insertBlsToExecutionChange").mockImplementation(() => {}),
            invoke: () =>
              facade.validateGossipBlsToExecutionChange(ssz.capella.SignedBLSToExecutionChange.serialize(value), value),
          };
        },
      },
      {
        name: "payload attestation",
        setup: () => {
          const value = ssz.gloas.PayloadAttestationMessage.defaultValue();
          const state = new BeaconStateView(generateCachedState());
          vi.spyOn(state, "getBeaconProposer").mockReturnValue(0);
          vi.spyOn(engine, "getHeadState").mockReturnValue(state);
          vi.spyOn(engine.beaconProposerCache, "has").mockReturnValue(true);
          return {
            validate: vi
              .spyOn(payloadAttestationValidation, "validateGossipPayloadAttestationMessage")
              .mockResolvedValue({attDataRootHex: toRootHex(Buffer.alloc(32)), validatorCommitteeIndices: [1, 4]}),
            insert: vi.spyOn(engine.payloadAttestationPool, "add").mockReturnValue(InsertOutcome.NewData),
            invoke: () =>
              facade.validateGossipPayloadAttestationMessage(
                ssz.gloas.PayloadAttestationMessage.serialize(value),
                value
              ),
          };
        },
      },
      {
        name: "execution payload bid",
        setup: () => {
          const value = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
          return {
            validate: vi
              .spyOn(bidValidation, "validateGossipExecutionPayloadBid")
              .mockResolvedValue({proposerIndex: 7}),
            insert: vi.spyOn(engine.executionPayloadBidPool, "add").mockReturnValue(InsertOutcome.NewData),
            invoke: () =>
              facade.validateGossipExecutionPayloadBid(
                ssz.gloas.SignedExecutionPayloadBid.serialize(value),
                value,
                ForkName.gloas,
                1
              ),
          };
        },
      },
      {
        name: "inclusion list",
        setup: () => {
          const value = ssz.heze.SignedInclusionList.defaultValue();
          return {
            validate: vi
              .spyOn(inclusionListValidation, "validateGossipInclusionList")
              .mockResolvedValue({committeeIndices: [0], totalBytes: 1}),
            insert: vi.spyOn(engine.inclusionListStore, "process").mockReturnValue(InclusionListInsertOutcome.New),
            invoke: () => facade.validateGossipInclusionList(ssz.heze.SignedInclusionList.serialize(value), value, 1),
          };
        },
      },
    ];

    describe.each(cases)("$name", ({name, setup}) => {
      it("returns acceptance before insertion and fork-choice updates", async () => {
        const {insert, invoke} = setup();
        expect((await invoke()).err).toBeNull();
        expect(insert).not.toHaveBeenCalled();
        expect(engine.forkChoice.onAttestation).not.toHaveBeenCalled();
        expect(engine.forkChoice.onAttesterSlashing).not.toHaveBeenCalled();
        expect(engine.forkChoice.notifyPtcMessages).not.toHaveBeenCalled();

        await vi.runOnlyPendingTimersAsync();

        expect(insert).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        if (name === "aggregate") expect(engine.forkChoice.onAttestation).toHaveBeenCalledOnce();
        if (name === "attester slashing") expect(engine.forkChoice.onAttesterSlashing).toHaveBeenCalledOnce();
        if (name === "payload attestation") expect(engine.forkChoice.notifyPtcMessages).toHaveBeenCalledOnce();
      });

      it("contains deferred insertion failures after returning acceptance", async () => {
        const {insert, invoke} = setup();
        const error = new Error("insertion failed");
        insert.mockImplementation(() => {
          throw error;
        });
        expect((await invoke()).err).toBeNull();
        expect(insert).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();

        expect(insert).toHaveBeenCalledOnce();
        expect([
          ...vi.mocked(engine.logger.error).mock.calls,
          ...vi.mocked(engine.logger.debug).mock.calls,
        ]).toContainEqual([expect.any(String), expect.anything(), error]);
        if (name === "aggregate") expect(engine.forkChoice.onAttestation).toHaveBeenCalledOnce();
        if (name === "payload attestation") expect(engine.forkChoice.notifyPtcMessages).toHaveBeenCalledOnce();
      });

      it.each([GossipAction.IGNORE, GossipAction.REJECT])("does not schedule handling after %s", async (action) => {
        const {validate, insert, invoke} = setup();
        validate.mockRejectedValue(new GossipActionError(action, {code: "TEST_VERDICT"}));
        expect((await invoke()).err?.status).toBe(action === GossipAction.IGNORE ? "ignore" : "reject");
        expect(vi.getTimerCount()).toBe(0);
        expect(insert).not.toHaveBeenCalled();
      });
    });
  }
);
