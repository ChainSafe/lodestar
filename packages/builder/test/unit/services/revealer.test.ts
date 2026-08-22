import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {Ledger} from "../../../src/services/ledger.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {BlockEvent, Revealer} from "../../../src/services/revealer.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockBuiltPayload} from "../utils/payload.js";

describe("Revealer", () => {
  const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 9));
  const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
  const signer = new BuilderSigner(config, {publicKey: secretKey.toPublicKey(), secretKey});
  const builderIndex = 7;
  const slot = 10;
  const parentBlockRoot = Buffer.alloc(32, 1);
  const blockHashBytes = Buffer.alloc(32, 2);
  const blockHash = toRootHex(blockHashBytes);
  const blockRoot = toRootHex(Buffer.alloc(32, 3));
  const cutoffBps = 5000;

  let logger: ReturnType<typeof getMockedLogger>;
  let clock: ClockMock;
  let api: ReturnType<typeof getApiClientStub>;
  let store: PayloadStore;
  let ledger: Ledger;
  let revealer: Revealer;

  function blockEvent(overrides: Partial<BlockEvent> = {}): BlockEvent {
    return {slot, block: blockRoot, executionOptimistic: false, builderIndex, blockHash, ...overrides};
  }

  beforeEach(() => {
    logger = getMockedLogger();
    clock = new ClockMock();
    clock.currentSlot = slot;
    api = getApiClientStub();
    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));
    store = new PayloadStore();
    store.add({
      slot,
      parentBlockRoot,
      blockHash,
      payload: mockBuiltPayload({slot, blockHash: blockHashBytes}),
    });
    ledger = new Ledger();
    ledger.recordBid({
      slot,
      parentBlockHash: toRootHex(Buffer.alloc(32, 1)),
      parentBlockRoot: toRootHex(parentBlockRoot),
      blockHash,
      valueGwei: 100,
    });
    revealer = new Revealer(
      {config, logger, clock, api, signer, store, ledger, builderIndex, metrics: null},
      {cutoffBps}
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  /** onBlock is fire-and-forget, wait for the async handler to settle */
  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it("reveals the payload for a block committing to our bid", async () => {
    revealer.onBlock(blockEvent());
    await flush();

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    const {signedEnvelopeOrContents} = api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][0];
    if (!("signedExecutionPayloadEnvelope" in signedEnvelopeOrContents)) {
      throw Error("Expected envelope contents with blobs");
    }
    const envelope = signedEnvelopeOrContents.signedExecutionPayloadEnvelope.message;
    expect(envelope.builderIndex).toEqual(builderIndex);
    expect(toRootHex(envelope.beaconBlockRoot)).toEqual(blockRoot);
    expect(envelope.parentBeaconBlockRoot).toEqual(parentBlockRoot);
    expect(envelope.payload.blockHash).toEqual(blockHashBytes);
    expect(ledger.hasRevealed(blockRoot)).toBe(true);
    expect(ledger.getUnsettledValueGwei(0)).toEqual(100);
  });

  it("reveals only once per block root", async () => {
    revealer.onBlock(blockEvent());
    revealer.onBlock(blockEvent());
    await flush();

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
  });

  it("reveals for every block root committing to the bid", async () => {
    const otherBlockRoot = toRootHex(Buffer.alloc(32, 4));
    revealer.onBlock(blockEvent());
    revealer.onBlock(blockEvent({block: otherBlockRoot}));
    await flush();

    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledTimes(2);
  });

  it("ignores blocks committing to other builders", async () => {
    revealer.onBlock(blockEvent({builderIndex: builderIndex + 1}));
    await flush();

    expect(api.beacon.getBlockV2).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("does not reveal an unknown payload", async () => {
    revealer.onBlock(blockEvent({blockHash: toRootHex(Buffer.alloc(32, 9))}));
    await flush();

    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Block commits to our builder index but payload is unknown, cannot reveal",
      expect.anything()
    );
  });

  it("does not reveal after the cutoff", async () => {
    clock.msFromSlotValue = config.getSlotComponentDurationMs(cutoffBps) + 1;
    revealer.onBlock(blockEvent());
    await flush();

    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Block with our bid arrived after reveal cutoff, not revealing",
      expect.anything()
    );
  });

  it("fetches the block if the event does not include the committed bid", async () => {
    const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = slot;
    signedBlock.message.body.signedExecutionPayloadBid.message.builderIndex = builderIndex;
    signedBlock.message.body.signedExecutionPayloadBid.message.blockHash = blockHashBytes;
    api.beacon.getBlockV2.mockResolvedValue(
      mockApiResponse({
        data: signedBlock,
        meta: {executionOptimistic: false, finalized: false, version: ForkName.gloas},
      })
    );

    revealer.onBlock(blockEvent({builderIndex: undefined, blockHash: undefined}));
    await flush();

    expect(api.beacon.getBlockV2).toHaveBeenCalledWith({blockId: blockRoot});
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
  });

  it("ignores fetched blocks committing to other builders", async () => {
    const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = slot;
    signedBlock.message.body.signedExecutionPayloadBid.message.builderIndex = builderIndex + 1;
    api.beacon.getBlockV2.mockResolvedValue(
      mockApiResponse({
        data: signedBlock,
        meta: {executionOptimistic: false, finalized: false, version: ForkName.gloas},
      })
    );

    revealer.onBlock(blockEvent({builderIndex: undefined, blockHash: undefined}));
    await flush();

    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });
});
