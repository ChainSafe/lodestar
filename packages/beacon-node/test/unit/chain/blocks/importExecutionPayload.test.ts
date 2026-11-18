import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {PayloadErrorCode} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {SeenPayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {IBeaconDb} from "../../../../src/db/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {GLOAS_FORK_EPOCH, config, generateBlock} from "../../../utils/blocksAndData.js";

// Consensus checks on the envelope are out of scope, only the execution engine verdict handling is tested
vi.mock("../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
  verifyExecutionPayloadEnvelopeSignature: vi.fn().mockResolvedValue(true),
}));

const {importExecutionPayload} = await import("../../../../src/chain/blocks/importExecutionPayload.js");

const GLOAS_SLOT = GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH;

describe("importExecutionPayload", () => {
  let abortController: AbortController;
  let clock: ClockStopped;
  let cache: SeenPayloadEnvelopeInput;
  let notifyNewPayload: ReturnType<typeof vi.fn>;
  let chain: BeaconChain;

  const {block, blockRoot, rootHex} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});

  beforeEach(() => {
    abortController = new AbortController();
    clock = new ClockStopped(GLOAS_SLOT);
    cache = new SeenPayloadEnvelopeInput({
      config,
      clock,
      forkChoice: {} as unknown as IForkChoice,
      chainEvents: new ChainEventEmitter(),
      signal: abortController.signal,
      serializedCache: new SerializedCache(),
      db: {} as unknown as IBeaconDb,
      seenBlockInputCache: {} as unknown as SeenBlockInput,
      custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
      metrics: null,
      logger: testLogger(),
    });
    notifyNewPayload = vi.fn().mockResolvedValue({
      status: ExecutionPayloadStatus.INVALID,
      latestValidHash: null,
      validationError: "invalid payload",
    });
    chain = {
      config,
      clock,
      logger: testLogger(),
      metrics: null,
      emitter: {emit: vi.fn()},
      forkChoice: {getBlockHexDefaultStatus: () => ({slot: GLOAS_SLOT, blockRoot: rootHex}) as ProtoBlock},
      regen: {getBlockSlotState: () => Promise.resolve({forkName: ForkName.gloas})},
      executionEngine: {notifyNewPayload},
      seenPayloadEnvelopeInputCache: cache,
    } as unknown as BeaconChain;
  });

  afterEach(() => {
    abortController.abort();
    vi.clearAllMocks();
  });

  function signedEnvelope(signatureByte: number): gloas.SignedExecutionPayloadEnvelope {
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = blockRoot;
    envelope.message.payload.slotNumber = GLOAS_SLOT;
    envelope.signature = new Uint8Array(96).fill(signatureByte);
    return envelope;
  }

  // Sync evicts the entry of an invalid envelope and adds the envelope it downloads to a new one
  function downloadedPayloadInput(envelope: gloas.SignedExecutionPayloadEnvelope): PayloadEnvelopeInput {
    const stale = cache.get(rootHex);
    if (stale !== undefined) {
      cache.removeInvalid(stale);
    }
    const payloadInput = cache.add({
      blockRootHex: rootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec: 0,
      source: PayloadEnvelopeInputSource.byRoot,
    });
    payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRoot, seenTimestampSec: 0});
    return payloadInput;
  }

  async function importAndGetErrorCode(envelope: gloas.SignedExecutionPayloadEnvelope): Promise<unknown> {
    return importExecutionPayload
      .call(chain, downloadedPayloadInput(envelope), DataAvailabilityStatus.Available, {validSignature: true})
      .then(
        () => null,
        (e) => e.type?.code ?? e
      );
  }

  it("does not send an envelope the execution engine declared invalid a second time", async () => {
    expect(await importAndGetErrorCode(signedEnvelope(1))).toBe(PayloadErrorCode.EXECUTION_ENGINE_INVALID);
    expect(notifyNewPayload).toHaveBeenCalledTimes(1);

    expect(await importAndGetErrorCode(signedEnvelope(1))).toBe(PayloadErrorCode.EXECUTION_ENGINE_INVALID);
    expect(notifyNewPayload).toHaveBeenCalledTimes(1);
  });

  it("sends another envelope of the same block to the execution engine", async () => {
    expect(await importAndGetErrorCode(signedEnvelope(1))).toBe(PayloadErrorCode.EXECUTION_ENGINE_INVALID);

    expect(await importAndGetErrorCode(signedEnvelope(2))).toBe(PayloadErrorCode.EXECUTION_ENGINE_INVALID);
    expect(notifyNewPayload).toHaveBeenCalledTimes(2);
  });

  it("asks the execution engine again after the retry window, which starts at the engine verdict", async () => {
    expect(await importAndGetErrorCode(signedEnvelope(1))).toBe(PayloadErrorCode.EXECUTION_ENGINE_INVALID);

    clock.setSlot(GLOAS_SLOT + SLOTS_PER_EPOCH - 1);
    expect(await importAndGetErrorCode(signedEnvelope(1))).toBe(PayloadErrorCode.EXECUTION_ENGINE_INVALID);
    expect(notifyNewPayload).toHaveBeenCalledTimes(1);

    clock.setSlot(GLOAS_SLOT + SLOTS_PER_EPOCH);
    expect(await importAndGetErrorCode(signedEnvelope(1))).toBe(PayloadErrorCode.EXECUTION_ENGINE_INVALID);
    expect(notifyNewPayload).toHaveBeenCalledTimes(2);
  });

  it("does not remember an envelope the execution engine could not judge", async () => {
    notifyNewPayload.mockResolvedValue({
      status: ExecutionPayloadStatus.ELERROR,
      latestValidHash: null,
      validationError: "engine error",
    });

    expect(await importAndGetErrorCode(signedEnvelope(1))).toBe(PayloadErrorCode.EXECUTION_ENGINE_ERROR);
    expect(await importAndGetErrorCode(signedEnvelope(1))).toBe(PayloadErrorCode.EXECUTION_ENGINE_ERROR);
    expect(notifyNewPayload).toHaveBeenCalledTimes(2);
  });
});
