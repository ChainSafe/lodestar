import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {PayloadEnvelopeInput} from "../../../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  GossipAction,
} from "../../../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {validateApiExecutionPayloadEnvelope} from "../../../../../../src/chain/validation/executionPayloadEnvelope.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
}));
vi.mock("../../../../../../src/chain/validation/executionPayloadEnvelope.js", () => ({
  validateApiExecutionPayloadEnvelope: vi.fn(),
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
    modules.network.publishExecutionPayloadEnvelope = vi.fn();
    modules.chain.processExecutionPayload = vi.fn();
  });

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
      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
      envelope.beaconBlockRoot = fromHex(blockRoot);
      envelope.payload.slotNumber = slot;

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

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: [], blobs: []},
          broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
        })
      ).rejects.toThrow(/proposer equivocation/);

      expect(modules.network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    });
  });

  describe("broadcast_validation=gossip", () => {
    function setupPayloadInput(): {
      payloadInput: PayloadEnvelopeInput;
      envelope: gloas.ExecutionPayloadEnvelope;
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
      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
      envelope.beaconBlockRoot = fromHex(blockRoot);
      envelope.payload.slotNumber = slot;

      modules.forkChoice.getBlockHex.mockReturnValue(generateProtoBlock({slot}));
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
      return {payloadInput, envelope};
    }

    it("skips envelope verification on import of the submitted envelope", async () => {
      const {payloadInput, envelope} = setupPayloadInput();

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await api.publishExecutionPayloadEnvelope({
        executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: [], blobs: []},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });

      expect(payloadInput.getPayloadEnvelope()).toBe(envelope);
      expect(modules.chain.processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validEnvelope: true});
    });

    it("verifies the envelope on import if it was added by another source", async () => {
      const {payloadInput, envelope} = setupPayloadInput();
      const cachedEnvelope = ssz.gloas.ExecutionPayloadEnvelope.clone(envelope);
      payloadInput.addPayloadEnvelope({
        envelope: cachedEnvelope,
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: 0,
        peerIdStr: undefined,
      });

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await api.publishExecutionPayloadEnvelope({
        executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: [], blobs: []},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });

      expect(payloadInput.getPayloadEnvelope()).toBe(cachedEnvelope);
      expect(modules.chain.processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validEnvelope: false});
    });

    it("returns success without publishing if the envelope is already known", async () => {
      const {payloadInput, envelope} = setupPayloadInput();
      vi.mocked(validateApiExecutionPayloadEnvelope).mockRejectedValueOnce(
        new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
          code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
          blockRoot: payloadInput.blockRootHex,
          slot: payloadInput.slot,
        })
      );

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          executionPayloadEnvelopeContents: {executionPayloadEnvelope: envelope, kzgProofs: [], blobs: []},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).resolves.toBeUndefined();

      expect(modules.network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    });
  });
});
