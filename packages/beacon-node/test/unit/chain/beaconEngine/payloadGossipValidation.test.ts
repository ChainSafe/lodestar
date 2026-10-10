import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {PayloadStatus} from "@lodestar/fork-choice";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {BeaconStateView, createCachedBeaconState} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {SeenEnginePayloadEnvelopeInput} from "../../../../src/chain/beaconEngine/seenEnginePayloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import * as envelopeVerification from "../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js";
import {DataColumnSidecarErrorCode, ExecutionPayloadEnvelopeErrorCode} from "../../../../src/chain/errors/index.js";
import {computeSubnetForDataColumnSidecar} from "../../../../src/chain/validation/dataColumnSidecar.js";
import {OpSource, ValidatorMonitor, createValidatorMonitor} from "../../../../src/chain/validatorMonitor.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateBlockWithColumnSidecars} from "../../../utils/blocksAndData.js";
import {generateState, zeroProtoBlock} from "../../../utils/state.js";

describe("BeaconEngine payload gossip validation", () => {
  const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32));
  let engine: BeaconEngine;
  let monitor: ValidatorMonitor;
  let chain: ReturnType<typeof getMockedBeaconChain>;
  let envelope: gloas.SignedExecutionPayloadEnvelope;
  let block: gloas.SignedBeaconBlock;
  let root: string;

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    engine = chain.beaconEngine;
    monitor = createValidatorMonitor(null, config, 0, chain.logger, {});
    engine.validatorMonitor = monitor;
    Object.defineProperty(engine, "seenPayloadEnvelopeInputCache", {
      value: new SeenEnginePayloadEnvelopeInput({
        config,
        forkChoice: chain.forkChoice,
        db: {block: {get: vi.fn().mockResolvedValue(null)}},
      }),
    });
    envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.payload.slotNumber = 1;
    envelope.message.builderIndex = BUILDER_INDEX_SELF_BUILD;
    block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.proposerIndex = 7;
    const bid = block.message.body.signedExecutionPayloadBid.message;
    bid.builderIndex = envelope.message.builderIndex;
    bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.message.executionRequests);
    envelope.message.beaconBlockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    root = toRootHex(envelope.message.beaconBlockRoot);
    engine.seenPayloadEnvelopeInputCache.add({blockRootHex: root, block, forkName: ForkName.gloas});
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue({...zeroProtoBlock, slot: 1, blockRoot: root});
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: Buffer.alloc(32),
      rootHex: zeroProtoBlock.blockRoot,
    });
    const state = new BeaconStateView(createCachedBeaconState(generateState({slot: 1}, config), {config, pubkeyCache}));
    chain.regen.getState.mockResolvedValue(state);
    chain.regen.getBlockSlotState.mockResolvedValue(state);
    vi.mocked(engine.bls.verifySignatureSets).mockResolvedValue(true);
    engine.validateGossipExecutionPayloadEnvelope =
      BeaconEngine.prototype.validateGossipExecutionPayloadEnvelope.bind(engine);
  });

  afterEach(() => vi.restoreAllMocks());

  function validateEnvelope() {
    return engine.validateGossipExecutionPayloadEnvelope(
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
      envelope,
      {source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 1, peerIdStr: "peer"}
    );
  }

  it("validates from the engine bid and caches the envelope without returning payload data", async () => {
    const observed = vi.spyOn(monitor, "registerExecutionPayloadEnvelope");
    const elapsed = vi.spyOn(engine.clock, "secFromSlot").mockReturnValue(1.25);
    const outcome = await validateEnvelope();
    expect(outcome).toEqual({status: "accept", value: undefined});
    expect(observed).toHaveBeenCalledExactlyOnceWith(OpSource.gossip, 1.25, envelope);
    expect(elapsed).toHaveBeenCalledWith(1, 1);
    const input = engine.seenPayloadEnvelopeInputCache.get(root);
    if (!input) throw new Error("Engine payload input missing after validation");
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(input.getPayloadEnvelope(), envelope)).toBe(true);
    expect(input?.getPayloadEnvelopeSource()).toEqual({
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 1,
      peerIdStr: "peer",
    });
    expect(engine.bls.verifySignatureSets).toHaveBeenCalledWith([expect.objectContaining({index: 7})], {
      verifyOnMainThread: true,
    });
  });

  it("does not retain envelopes that fail bid checks or signature validation", async () => {
    const observed = vi.spyOn(monitor, "registerExecutionPayloadEnvelope");
    envelope.message.builderIndex = 0;
    expect(await validateEnvelope()).toMatchObject({
      status: "reject",
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
    });
    expect(engine.bls.verifySignatureSets).not.toHaveBeenCalled();
    envelope.message.builderIndex = BUILDER_INDEX_SELF_BUILD;
    vi.mocked(engine.bls.verifySignatureSets).mockResolvedValue(false);
    expect(await validateEnvelope()).toMatchObject({
      status: "reject",
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE,
    });
    expect(engine.seenPayloadEnvelopeInputCache.get(root)?.hasPayloadEnvelope()).toBe(false);
    expect(observed).not.toHaveBeenCalled();
  });

  it("preserves FULL-only duplicate suppression even when validation is cached", async () => {
    const observed = vi.spyOn(monitor, "registerExecutionPayloadEnvelope");
    await validateEnvelope();
    expect((await validateEnvelope()).status).toBe("accept");
    chain.forkChoice.getBlockHex.mockReturnValue({...zeroProtoBlock, payloadStatus: PayloadStatus.FULL});
    expect(await validateEnvelope()).toMatchObject({
      status: "ignore",
      code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
    });
    expect(engine.bls.verifySignatureSets).toHaveBeenCalledTimes(2);
    expect(observed).toHaveBeenCalledTimes(2);
  });

  it("records API validation in the engine cache", async () => {
    const observed = vi.spyOn(monitor, "registerExecutionPayloadEnvelope");
    const result = await BeaconEngine.prototype.validateApiExecutionPayloadEnvelope.call(
      engine,
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
      envelope,
      1
    );
    expect(result.status).toBe("accept");
    expect(engine.seenPayloadEnvelopeInputCache.get(root)?.getPayloadEnvelopeSource().source).toBe(
      PayloadEnvelopeInputSource.api
    );
    expect(observed).not.toHaveBeenCalled();
  });

  it("reloads a live block for validation and retains by-root source metadata", async () => {
    const observed = vi.spyOn(monitor, "registerExecutionPayloadEnvelope");
    const get = vi.fn().mockResolvedValue(block);
    Object.defineProperty(engine, "seenPayloadEnvelopeInputCache", {
      value: new SeenEnginePayloadEnvelopeInput({config, forkChoice: chain.forkChoice, db: {block: {get}}}),
    });
    chain.forkChoice.hasBlockHex.mockReturnValue(true);
    const source = {source: PayloadEnvelopeInputSource.byRoot, seenTimestampSec: 2, peerIdStr: "sync-peer"};
    const result = await engine.validateGossipExecutionPayloadEnvelope(
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
      envelope,
      source
    );
    expect(result.status).toBe("accept");
    expect(get).toHaveBeenCalledExactlyOnceWith(envelope.message.beaconBlockRoot);
    expect(engine.seenPayloadEnvelopeInputCache.get(root)?.getPayloadEnvelopeSource()).toEqual(source);
    expect(observed).not.toHaveBeenCalled();
  });

  it("keeps the accepted gossip verdict when envelope monitoring fails", async () => {
    const observed = vi.spyOn(monitor, "registerExecutionPayloadEnvelope").mockImplementation(() => {
      throw new Error("monitor failed");
    });
    expect((await validateEnvelope()).status).toBe("accept");
    expect(observed).toHaveBeenCalledOnce();
    expect(chain.logger.debug).toHaveBeenCalledWith(
      "Error monitoring gossip execution payload envelope",
      {slot: 1},
      expect.any(Error)
    );
  });

  it("accepts envelopes and API observations when monitoring is disabled", async () => {
    engine.validatorMonitor = null;
    expect((await validateEnvelope()).status).toBe("accept");
    await expect(
      BeaconEngine.prototype.registerApiExecutionPayloadEnvelope.call(engine, 1.25, envelope)
    ).resolves.toBeUndefined();
  });

  it("clears a matching API candidate on failed consensus checks, but retains it on missing state", async () => {
    await validateEnvelope();
    chain.forkChoice.getBlockHex.mockReturnValue({...zeroProtoBlock, slot: 1, blockRoot: root});
    chain.regen.getBlockSlotState.mockRejectedValueOnce(new Error("state unavailable"));
    const verify = () => BeaconEngine.prototype.verifyEnvelopeForPublish.call(engine, new Uint8Array(), envelope, root);
    await expect(verify()).rejects.toThrow("Unable to regenerate");
    expect(engine.seenPayloadEnvelopeInputCache.get(root)?.hasPayloadEnvelope()).toBe(true);
    vi.spyOn(envelopeVerification, "verifyExecutionPayloadEnvelope").mockImplementation(() => {
      throw new Error("invalid fields");
    });
    await expect(verify()).rejects.toThrow("invalid fields");
    expect(engine.seenPayloadEnvelopeInputCache.get(root)).toBeUndefined();
  });

  it("validates Gloas column proofs using commitments from the engine cache", async () => {
    const {block, rootHex, columnSidecars} = generateBlockWithColumnSidecars({forkName: ForkName.gloas});
    engine.seenPayloadEnvelopeInputCache.add({block, blockRootHex: rootHex, forkName: ForkName.gloas});
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue({
      ...zeroProtoBlock,
      slot: block.message.slot,
      blockRoot: rootHex,
    });
    const column = columnSidecars[0];
    const bytes = ssz.gloas.DataColumnSidecar.serialize(column);
    const subnet = computeSubnetForDataColumnSidecar(config, column);
    const result = await BeaconEngine.prototype.validateGossipGloasDataColumnSidecar.call(
      engine,
      bytes,
      column,
      subnet
    );
    expect(result).toEqual({status: "accept", value: undefined});
  });

  it("ignores columns whose bid cannot be recovered", async () => {
    const column = ssz.gloas.DataColumnSidecar.defaultValue();
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(zeroProtoBlock);
    chain.forkChoice.hasBlockHex.mockReturnValue(false);
    const result = await BeaconEngine.prototype.validateGossipGloasDataColumnSidecar.call(
      engine,
      ssz.gloas.DataColumnSidecar.serialize(column),
      column,
      0
    );
    expect(result).toMatchObject({status: "ignore", code: DataColumnSidecarErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING});
  });
});
