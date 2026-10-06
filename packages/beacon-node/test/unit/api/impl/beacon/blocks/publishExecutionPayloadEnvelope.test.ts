import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView, computeTimeAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {PayloadEnvelopeInput} from "../../../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {ExecutionPayloadEnvelopeErrorCode} from "../../../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {validateApiExecutionPayloadEnvelope} from "../../../../../../src/chain/validation/executionPayloadEnvelope.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
}));
vi.mock("../../../../../../src/chain/validation/executionPayloadEnvelope.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../../../src/chain/validation/executionPayloadEnvelope.js")>();
  return {...actual, validateApiExecutionPayloadEnvelope: vi.fn(actual.validateApiExecutionPayloadEnvelope)};
});

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
    signedBlock.message.slot = 1;
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
    cachedEnvelope.message.payload.slotNumber = signedBlock.message.slot;
    const incomingEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.clone(cachedEnvelope);
    if (conflicting) incomingEnvelope.message.payload.blockHash = new Uint8Array(32).fill(1);
    modules.forkChoice.getBlockHex.mockImplementation((_root, status) =>
      status === PayloadStatus.FULL ? null : generateProtoBlock({slot: 1})
    );
    modules.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: 1}));
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      ...ssz.phase0.Checkpoint.defaultValue(),
      rootHex: toRootHex(new Uint8Array(32)),
    });
    vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
    const addCachedEnvelope = () =>
      payloadInput.addPayloadEnvelope({
        envelope: cachedEnvelope,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: 0,
      });
    const warning = [
      "Execution payload envelope block hash differs from already-known envelope",
      expect.objectContaining({
        slot: 1,
        blockRoot,
        code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
        blockHash: toRootHex(incomingEnvelope.message.payload.blockHash),
        knownBlockHash: toRootHex(cachedEnvelope.message.payload.blockHash),
      }),
    ];
    return {
      api: getBeaconBlockApi(modules),
      payloadInput,
      cachedEnvelope,
      incomingEnvelope,
      blockRoot,
      addCachedEnvelope,
      expectedWarnings: conflicting ? [warning] : [],
    };
  }

  describe.each([false, true])("conflicting hash=%s", (conflicting) => {
    it.each([true, false])("handles a stateful duplicate with cached envelope=%s", async (cached) => {
      const {api, payloadInput, cachedEnvelope, incomingEnvelope, addCachedEnvelope, expectedWarnings} =
        setupEnvelope(conflicting);
      addCachedEnvelope();
      if (!cached) {
        vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(undefined);
        modules.forkChoice.getBlockHex.mockImplementation((_root, status) =>
          generateProtoBlock({
            slot: 1,
            executionPayloadBlockHash: toRootHex(
              status === PayloadStatus.FULL ? cachedEnvelope.message.payload.blockHash : new Uint8Array(32).fill(2)
            ),
          })
        );
      }

      await api.publishExecutionPayloadEnvelope({signedEnvelopeOrContents: incomingEnvelope});

      expect(payloadInput.getPayloadEnvelope()).toBe(cachedEnvelope);
      expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
      expect(modules.chain.logger.warn.mock.calls).toEqual(expectedWarnings);
    });

    it("handles gossip during the slot wait with validation disabled", async () => {
      vi.useFakeTimers();
      const {api, payloadInput, cachedEnvelope, incomingEnvelope, addCachedEnvelope, expectedWarnings} =
        setupEnvelope(conflicting);
      vi.setSystemTime(computeTimeAtSlot(config, 1, modules.chain.genesisTime) * 1000 - 1000);
      const publish = api.publishExecutionPayloadEnvelope({
        signedEnvelopeOrContents: incomingEnvelope,
        broadcastValidation: routes.beacon.BroadcastValidation.none,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
      addCachedEnvelope();
      await vi.advanceTimersByTimeAsync(1000);
      await publish;

      expect(payloadInput.getPayloadEnvelope()).toBe(cachedEnvelope);
      expect(modules.chain.processExecutionPayload.mock.calls).toEqual([[payloadInput, {validSignature: true}]]);
      expect(modules.network.publishSignedExecutionPayloadEnvelope.mock.calls).toEqual([[incomingEnvelope]]);
      expect(modules.chain.logger.warn.mock.calls).toEqual(expectedWarnings);
    });

    it("continues a stateless duplicate publish", async () => {
      const {api, payloadInput, cachedEnvelope, incomingEnvelope, addCachedEnvelope, expectedWarnings} =
        setupEnvelope(conflicting);
      addCachedEnvelope();

      await api.publishExecutionPayloadEnvelope({
        signedEnvelopeOrContents: {signedExecutionPayloadEnvelope: incomingEnvelope, blobs: [], kzgProofs: []},
      });

      expect(payloadInput.getPayloadEnvelope()).toBe(cachedEnvelope);
      expect(modules.chain.processExecutionPayload.mock.calls).toEqual([[payloadInput, {validSignature: true}]]);
      expect(modules.network.publishSignedExecutionPayloadEnvelope.mock.calls).toEqual([[incomingEnvelope]]);
      expect(modules.chain.logger.warn.mock.calls).toEqual(expectedWarnings);
    });
  });

  it("rejects a first envelope whose hash differs from the bid", async () => {
    const {api, incomingEnvelope, payloadInput} = setupEnvelope(true);

    await expect(
      api.publishExecutionPayloadEnvelope({signedEnvelopeOrContents: incomingEnvelope})
    ).rejects.toMatchObject({
      type: {code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH},
    });

    expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
    expect(modules.chain.logger.warn).not.toHaveBeenCalled();
  });

  describe("broadcast_validation=consensus_and_equivocation", () => {
    it("rejects an envelope for an observed proposer equivocation", async () => {
      const {api, payloadInput, incomingEnvelope: signedEnvelope, blockRoot} = setupEnvelope(false);
      const slot = signedEnvelope.message.payload.slotNumber;
      const proposerIndex = payloadInput.proposerIndex;
      const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 1));
      vi.mocked(validateApiExecutionPayloadEnvelope).mockResolvedValueOnce();
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
