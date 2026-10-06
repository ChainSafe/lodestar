import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
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
    vi.mocked(validateApiExecutionPayloadEnvelope).mockReset();
    modules = getApiTestModules({config});
    Object.defineProperty(modules.chain, "blockProductionCache", {value: {get: vi.fn()}});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.network.publishSignedExecutionPayloadEnvelope = vi.fn();
    modules.chain.processExecutionPayload = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupEnvelope(conflicting: boolean) {
    const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
    const blockRoot = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(signedBlock.message));
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      blockRootHex: blockRoot,
      block: signedBlock,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec: 0,
      source: PayloadEnvelopeInputSource.gossip,
      daOutOfRange: false,
    });
    const cachedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    cachedEnvelope.message.beaconBlockRoot = fromHex(blockRoot);
    const incomingEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.clone(cachedEnvelope);
    if (conflicting) incomingEnvelope.message.payload.blockHash = new Uint8Array(32).fill(1);
    modules.forkChoice.getBlockHex.mockReturnValue(generateProtoBlock({slot: 0}));
    vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
    const addCachedEnvelope = () =>
      payloadInput.addPayloadEnvelope({
        envelope: cachedEnvelope,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: 0,
      });
    return {
      api: getBeaconBlockApi(modules),
      payloadInput,
      cachedEnvelope,
      incomingEnvelope,
      blockRoot,
      addCachedEnvelope,
    };
  }

  it.each([false, true])("handles an already-known envelope with conflicting hash=%s", async (conflicting) => {
    const {api, payloadInput, cachedEnvelope, incomingEnvelope, blockRoot, addCachedEnvelope} =
      setupEnvelope(conflicting);
    addCachedEnvelope();
    vi.mocked(validateApiExecutionPayloadEnvelope).mockRejectedValueOnce(
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
        blockRoot,
        slot: 0,
      })
    );

    await api.publishExecutionPayloadEnvelope({signedEnvelopeOrContents: incomingEnvelope});

    expect(payloadInput.getPayloadEnvelope()).toBe(cachedEnvelope);
    expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
    expect(modules.chain.logger.warn).toHaveBeenCalledTimes(conflicting ? 1 : 0);
    if (conflicting) {
      expect(modules.chain.logger.warn).toHaveBeenCalledWith(
        "Execution payload envelope block hash differs from already-known envelope",
        expect.objectContaining({
          slot: 0,
          blockRoot,
          blockHash: toRootHex(incomingEnvelope.message.payload.blockHash),
          knownBlockHash: toRootHex(cachedEnvelope.message.payload.blockHash),
        })
      );
    }
  });

  it("warns about a conflicting retry after the envelope was pruned from memory", async () => {
    const {api, incomingEnvelope, blockRoot} = setupEnvelope(true);
    vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(undefined);
    modules.forkChoice.getBlockHex.mockImplementation((_root, status) =>
      generateProtoBlock({
        slot: 0,
        executionPayloadBlockHash: status === PayloadStatus.FULL ? toRootHex(new Uint8Array(32)) : null,
      })
    );
    vi.mocked(validateApiExecutionPayloadEnvelope).mockRejectedValueOnce(
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
        blockRoot,
        slot: 0,
      })
    );

    await api.publishExecutionPayloadEnvelope({signedEnvelopeOrContents: incomingEnvelope});

    expect(modules.chain.logger.warn).toHaveBeenCalledOnce();
    expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });

  it.each([false, true])("handles gossip during the slot wait with conflicting hash=%s", async (conflicting) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const {api, payloadInput, cachedEnvelope, incomingEnvelope, addCachedEnvelope} = setupEnvelope(conflicting);
    Object.assign(modules.chain, {genesisTime: 1001});
    const publish = api.publishExecutionPayloadEnvelope({signedEnvelopeOrContents: incomingEnvelope});
    await vi.advanceTimersByTimeAsync(0);
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    addCachedEnvelope();
    await vi.advanceTimersByTimeAsync(1000);
    await publish;

    expect(payloadInput.getPayloadEnvelope()).toBe(cachedEnvelope);
    expect(modules.chain.processExecutionPayload).toHaveBeenCalledOnce();
    expect(modules.network.publishSignedExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(modules.chain.logger.warn).toHaveBeenCalledTimes(conflicting ? 1 : 0);
  });

  it.each([false, true])("continues a stateless duplicate publish with conflicting hash=%s", async (conflicting) => {
    const {api, incomingEnvelope, blockRoot, addCachedEnvelope} = setupEnvelope(conflicting);
    addCachedEnvelope();
    vi.mocked(validateApiExecutionPayloadEnvelope).mockRejectedValueOnce(
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
        blockRoot,
        slot: 0,
      })
    );

    await api.publishExecutionPayloadEnvelope({
      signedEnvelopeOrContents: {signedExecutionPayloadEnvelope: incomingEnvelope, blobs: [], kzgProofs: []},
    });

    expect(modules.chain.processExecutionPayload).toHaveBeenCalledOnce();
    expect(modules.network.publishSignedExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(modules.chain.logger.warn).toHaveBeenCalledTimes(conflicting ? 1 : 0);
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

      const api = getBeaconBlockApi(modules);
      await expect(
        api.publishExecutionPayloadEnvelope({
          signedEnvelopeOrContents: signedEnvelope,
          broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
        })
      ).rejects.toThrow(/proposer equivocation/);

      expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    });
  });
});
