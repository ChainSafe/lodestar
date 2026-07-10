import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SeenPayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {getMockedClock} from "../../../mocks/clock.js";
import {config, generateBlock} from "../../../utils/blocksAndData.js";

// verifyExecutionPayloadEnvelope + signature run before the EL call; stub the CL-side verification so
// the test can isolate the EL response handling (the envelope is "CL-valid").
vi.mock("../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
  verifyExecutionPayloadEnvelopeSignature: vi.fn().mockResolvedValue(true),
}));

// Import after vi.mock so the mocked module is wired in.
const {importExecutionPayload} = await import("../../../../src/chain/blocks/importExecutionPayload.js");

describe("importExecutionPayload / EL INVALID marks payload invalid", () => {
  let cache: SeenPayloadEnvelopeInput;
  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();
    cache = new SeenPayloadEnvelopeInput({
      config,
      clock: getMockedClock(),
      forkChoice: {getAllAncestorBlocks: vi.fn()} as any,
      chainEvents: new ChainEventEmitter(),
      signal: abortController.signal,
      serializedCache: new SerializedCache(),
      metrics: null,
      logger: testLogger(),
    });
  });

  afterEach(() => {
    abortController.abort();
    vi.clearAllMocks();
  });

  function makeInput() {
    const {block, rootHex, blockRoot} = generateBlock({forkName: ForkName.gloas, slot: 0});
    const input = cache.add({
      blockRootHex: rootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      timeCreatedSec: 0,
    });
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.beaconBlockRoot = blockRoot;
    input.addPayloadEnvelope({
      envelope: signedEnvelope,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 0,
      peerIdStr: "peer",
    });
    return {input, rootHex};
  }

  function makeChain(status: ExecutionPayloadStatus): BeaconChain {
    return {
      config,
      clock: {currentSlot: 0} as any,
      emitter: {emit: vi.fn()} as any,
      forkChoice: {
        getBlockHexDefaultStatus: (_root: string) => ({slot: 0}) as ProtoBlock,
      } as any,
      regen: {
        getBlockSlotState: () => Promise.resolve({forkName: ForkName.gloas} as any),
      } as any,
      executionEngine: {
        notifyNewPayload: vi.fn().mockResolvedValue({status, validationError: "boom"}),
      } as any,
    } as unknown as BeaconChain;
  }

  it("EL INVALID -> throws EXECUTION_ENGINE_INVALID and flags the payload input invalid", async () => {
    const {input} = makeInput();
    expect(input.isPayloadInvalid()).toBe(false);

    const chain = makeChain(ExecutionPayloadStatus.INVALID);
    await expect(
      importExecutionPayload.call(chain, input, DataAvailabilityStatus.PreData, {validSignature: true})
    ).rejects.toMatchObject({type: {code: "PAYLOAD_ERROR_EXECUTION_ENGINE_INVALID"}});

    expect(input.isPayloadInvalid()).toBe(true);
  });

  it("EL transient error (INVALID_BLOCK_HASH) does NOT flag the payload input invalid", async () => {
    const {input} = makeInput();

    const chain = makeChain(ExecutionPayloadStatus.INVALID_BLOCK_HASH);
    await expect(
      importExecutionPayload.call(chain, input, DataAvailabilityStatus.PreData, {validSignature: true})
    ).rejects.toMatchObject({type: {code: "PAYLOAD_ERROR_EXECUTION_ENGINE_ERROR"}});

    // Transient EL errors are not "payload failed validation" — must not be marked invalid.
    expect(input.isPayloadInvalid()).toBe(false);
  });
});
