import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView, computeTimeAtSlot} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {BeaconEngineCore} from "../../../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {accept} from "../../../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {PayloadEnvelopeInput} from "../../../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {OpSource, createValidatorMonitor} from "../../../../../../src/chain/validatorMonitor.js";
import {withBeaconEngineFacade} from "../../../../../mocks/mockedBeaconChain.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
}));

describe("api - beacon - publishExecutionPayloadEnvelope", () => {
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  let modules: ApiTestModules;

  beforeEach(() => {
    modules = getApiTestModules({config});
    Object.defineProperty(modules.chain, "blockProductionCache", {value: {get: vi.fn()}});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.network.publishSignedExecutionPayloadEnvelope = vi.fn();
    modules.chain.processExecutionPayload = vi.fn();
    const core: BeaconEngineCore = modules.chain.beaconEngine;
    core.validateApiExecutionPayloadEnvelope = vi
      .fn<BeaconEngineCore["validateApiExecutionPayloadEnvelope"]>()
      .mockResolvedValue(accept(undefined));
    modules.chain.beaconEngine.getConflictingBlockRoots = BeaconEngineCore.prototype.getConflictingBlockRoots.bind(
      modules.chain.beaconEngine
    );
    modules.chain.beaconEngine.validatorMonitor = createValidatorMonitor(null, config, 0, modules.logger, {});
    modules.chain.beaconEngine.registerApiExecutionPayloadEnvelope = (...args) =>
      BeaconEngineCore.prototype.registerApiExecutionPayloadEnvelope.call(modules.chain.beaconEngine, ...args);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    {success: true, broadcastValidation: routes.beacon.BroadcastValidation.gossip},
    {success: false, broadcastValidation: routes.beacon.BroadcastValidation.gossip},
  ])(
    "observes before publication with validation=$broadcastValidation, success=$success",
    async ({success, broadcastValidation}) => {
      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = 1;
      const blockRoot = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(signedBlock.message));
      const payloadInput = PayloadEnvelopeInput.createFromBlock({
        blockRootHex: blockRoot,
        block: signedBlock,
        forkName: ForkName.gloas,
        sampledColumns: [],
        custodyColumns: [],
        seenTimestampSec: 0,
        source: PayloadEnvelopeInputSource.byRange,
        daOutOfRange: false,
      });
      const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      signedEnvelope.message.beaconBlockRoot = fromHex(blockRoot);
      signedEnvelope.message.payload.slotNumber = 1;
      const seenTimestampSec = computeTimeAtSlot(config, 1, modules.chain.genesisTime) + 1.25;
      vi.spyOn(Date, "now").mockReturnValue(seenTimestampSec * 1000);
      vi.mocked(modules.chain.beaconEngine.validateApiExecutionPayloadEnvelope).mockImplementation(async () => {
        vi.mocked(Date.now).mockReturnValue((seenTimestampSec + 1) * 1000);
        return accept(undefined);
      });
      modules.forkChoice.getBlockHex.mockReturnValue(generateProtoBlock({slot: 1}));
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
      const monitor = modules.chain.beaconEngine.validatorMonitor;
      if (!monitor) throw new Error("Missing monitor");
      const observed = vi.spyOn(monitor, "registerExecutionPayloadEnvelope");
      modules.network.publishSignedExecutionPayloadEnvelope = vi.fn().mockImplementation(async () => {
        expect(payloadInput.hasPayloadEnvelope()).toBe(true);
        expect(observed).toHaveBeenCalledExactlyOnceWith(OpSource.api, 1.25, signedEnvelope);
        if (!success) throw new Error("publication failed");
        return 1;
      });

      const pending = getBeaconBlockApi(defaultApiOptions, {
        ...modules,
        chain: withBeaconEngineFacade(modules.chain),
      }).publishExecutionPayloadEnvelope({
        signedEnvelopeOrContents: signedEnvelope,
        broadcastValidation,
      });
      if (success) await expect(pending).resolves.toBeUndefined();
      else await expect(pending).rejects.toThrow("publication failed");
      expect(observed).toHaveBeenCalledExactlyOnceWith(OpSource.api, 1.25, signedEnvelope);
      expect(modules.network.publishSignedExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    }
  );

  describe("broadcast_validation=consensus_and_equivocation", () => {
    it("rejects an envelope for an observed proposer equivocation", async () => {
      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      const slot = signedBlock.message.slot;
      const proposerIndex = signedBlock.message.proposerIndex;
      const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
      const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 1));
      const payloadInput = PayloadEnvelopeInput.createFromBlock({
        blockRootHex: blockRoot,
        block: signedBlock,
        forkName: ForkName.gloas,
        sampledColumns: [],
        custodyColumns: [],
        seenTimestampSec: 0,
        source: PayloadEnvelopeInputSource.byRange,
        daOutOfRange: false,
      });
      const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      signedEnvelope.message.beaconBlockRoot = fromHex(blockRoot);
      signedEnvelope.message.payload.slotNumber = slot;

      modules.forkChoice.getBlockHex.mockReturnValue(generateProtoBlock({slot}));
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
      modules.chain.regen.getBlockSlotState.mockResolvedValue({forkName: ForkName.gloas} as IBeaconStateView);
      modules.chain.seenBlockProposers.add(slot, proposerIndex, blockRoot);
      modules.chain.seenBlockProposers.observeBlockRoot(
        slot,
        proposerIndex,
        blockRoot,
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );
      modules.chain.seenBlockProposers.observeBlockRoot(
        slot,
        proposerIndex,
        conflictingBlockRoot,
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );

      const monitor = modules.chain.beaconEngine.validatorMonitor;
      if (!monitor) throw new Error("Missing monitor");
      const observed = vi.spyOn(monitor, "registerExecutionPayloadEnvelope");
      const api = getBeaconBlockApi(defaultApiOptions, {...modules, chain: withBeaconEngineFacade(modules.chain)});
      await expect(
        api.publishExecutionPayloadEnvelope({
          signedEnvelopeOrContents: signedEnvelope,
          broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
        })
      ).rejects.toThrow(/proposer equivocation/);

      expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
      expect(observed).not.toHaveBeenCalled();
    });
  });

  describe("broadcast_validation=gossip", () => {
    function setupPayloadInput(): {
      payloadInput: PayloadEnvelopeInput;
      signedEnvelope: gloas.SignedExecutionPayloadEnvelope;
    } {
      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      const slot = signedBlock.message.slot;
      const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
      const payloadInput = PayloadEnvelopeInput.createFromBlock({
        blockRootHex: blockRoot,
        block: signedBlock,
        forkName: ForkName.gloas,
        sampledColumns: [],
        custodyColumns: [],
        seenTimestampSec: 0,
        source: PayloadEnvelopeInputSource.byRange,
        daOutOfRange: false,
      });
      const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      signedEnvelope.message.beaconBlockRoot = fromHex(blockRoot);
      signedEnvelope.message.payload.slotNumber = slot;

      modules.forkChoice.getBlockHex.mockReturnValue(generateProtoBlock({slot}));
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
      return {payloadInput, signedEnvelope};
    }

    it("skips signature verification on import of the submitted envelope", async () => {
      const {payloadInput, signedEnvelope} = setupPayloadInput();

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await api.publishExecutionPayloadEnvelope({
        signedEnvelopeOrContents: signedEnvelope,
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });

      expect(payloadInput.getPayloadEnvelope()).toBe(signedEnvelope);
      expect(modules.chain.processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validSignature: true});
    });

    it("verifies signature on import of an envelope added by another source", async () => {
      const {payloadInput, signedEnvelope} = setupPayloadInput();
      const cachedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.clone(signedEnvelope);
      cachedEnvelope.signature = Buffer.alloc(96, 1);
      payloadInput.addPayloadEnvelope({
        envelope: cachedEnvelope,
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: 0,
        peerIdStr: undefined,
      });

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await api.publishExecutionPayloadEnvelope({
        signedEnvelopeOrContents: signedEnvelope,
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });

      expect(payloadInput.getPayloadEnvelope()).toBe(cachedEnvelope);
      expect(modules.chain.processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validSignature: false});
    });
  });
});
