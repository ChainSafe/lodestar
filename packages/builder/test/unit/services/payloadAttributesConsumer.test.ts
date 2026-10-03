import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, MIN_DEPOSIT_AMOUNT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Clock, computeTimeAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, toHex, toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidPublisher} from "../../../src/services/bidPublisher.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {PayloadAttributesConsumer} from "../../../src/services/payloadAttributesConsumer.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {type SlotBidResult, SlotBidder} from "../../../src/services/slotBidder.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockBuiltPayload} from "../utils/payload.js";

describe("Gloas payload attributes consumer", () => {
  beforeEach(() => vi.useFakeTimers({now: 0}));
  afterEach(() => vi.useRealTimers());

  it.each([10, SLOTS_PER_EPOCH])("correlates the head and preference for proposal slot %s", async (slot) => {
    const {consumer, head, attributes, run, signal, executionFeeRecipient} = setup(slot);
    await consumer.onEvent(head, signal);
    const original = ssz.gloas.SSEPayloadAttributes.toJson(attributes.message.data);
    expect(await consumer.onEvent(attributes, signal)).toMatchObject({status: "published"});
    expect(run).toHaveBeenCalledOnce();
    const input = run.mock.calls[0][0];
    expect(input.job.request.forkchoiceState).toEqual({
      headBlockHash: toRootHex(attributes.message.data.parentBlockHash),
      safeBlockHash: toRootHex(attributes.message.data.safeBlockHash),
      finalizedBlockHash: toRootHex(attributes.message.data.finalizedBlockHash),
    });
    expect(input.job.request.payloadAttributes.suggestedFeeRecipient).toBe(toHex(executionFeeRecipient));
    expect(input.proposerFeeRecipient).toEqual(Buffer.alloc(20, 8));
    expect(ssz.gloas.SSEPayloadAttributes.toJson(attributes.message.data)).toEqual(original);
  });

  it("uses finality hashes decoded from the fork-specific payload-attributes data", async () => {
    const {config, consumer, head, attributes, run, signal} = setup();
    const codec = routes.events.getTypeByEvent(config)[routes.events.EventType.payloadAttributes];
    const message = codec.fromJson(codec.toJson(attributes.message));
    await consumer.onEvent(head, signal);
    await consumer.onEvent({type: routes.events.EventType.payloadAttributes, message}, signal);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0].job.request.forkchoiceState).toEqual({
      headBlockHash: toRootHex(attributes.message.data.parentBlockHash),
      safeBlockHash: toRootHex(attributes.message.data.safeBlockHash),
      finalizedBlockHash: toRootHex(attributes.message.data.finalizedBlockHash),
    });
  });

  it("feeds the actual SlotBidder and retains the payload before publication", async () => {
    const {consumer, head, attributes, run, signal, config, api} = setup();
    const data = attributes.message.data;
    const payload = mockBuiltPayload({
      slot: data.proposalSlot,
      parentHash: data.parentBlockHash,
      prevRandao: data.payloadAttributes.prevRandao,
      valueGwei: 10,
    });
    const store = new PayloadStore();
    const ledger = new BidLedger();
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
    const signer = new BuilderSigner(config, {secretKey, publicKey: secretKey.toPublicKey()});
    Object.assign(api.beacon, {publishExecutionPayloadBid: vi.fn()});
    api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
    const publisher = new BidPublisher({
      api,
      config,
      signer,
      ledger,
      builderIndex: 9,
      hasPayload: (identity) => {
        expect(store.get(identity.blockHash)).not.toBeNull();
        return store.get(identity.blockHash) !== null;
      },
    });
    const publish = vi.spyOn(publisher, "publish");
    const bidder = new SlotBidder(
      {
        buildPayload: vi.fn().mockResolvedValue({...payload, fork: ForkName.gloas}),
        store,
        policy: {computeValue: () => 1},
        ledger,
        publisher,
        builderIndex: 9,
        builderStatusTracker: {getStatus: () => ({status: "active", balance: MIN_DEPOSIT_AMOUNT + 100})},
      },
      {minOperatingBalanceGwei: MIN_DEPOSIT_AMOUNT}
    );
    run.mockImplementation((input, jobSignal) => bidder.run(input, jobSignal));
    await consumer.onEvent(head, signal);
    expect(await consumer.onEvent(attributes, signal)).toMatchObject({status: "published"});
    expect(publish).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][0]).toMatchObject({slot: data.proposalSlot, feeRecipient: Buffer.alloc(20, 8)});
  });

  it("shares duplicate in-flight events without invoking SlotBidder twice", async () => {
    const {consumer, head, attributes, run, signal} = setup();
    const pending = defer<SlotBidResult>();
    run.mockReturnValueOnce(pending.promise);
    await consumer.onEvent(head, signal);
    const first = consumer.onEvent(attributes, signal);
    const duplicate = consumer.onEvent(attributes, signal);
    expect(run).toHaveBeenCalledOnce();
    pending.resolve({status: "not_published", reason: "policy_declined"});
    expect(await first).toEqual(await duplicate);
  });

  it("does not restart after close", async () => {
    const {consumer, head, attributes, run, signal} = setup();
    consumer.close();
    await consumer.onEvent(head, signal);
    expect(await consumer.onEvent(attributes, signal)).toMatchObject({reason: "closed"});
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects late results for every caller sharing an aborted job", async () => {
    const {consumer, head, attributes, run, signal, controller} = setup();
    const pending = defer<SlotBidResult>();
    run.mockReturnValueOnce(pending.promise);
    await consumer.onEvent(head, signal);
    const first = consumer.onEvent(attributes, signal);
    const duplicate = consumer.onEvent(attributes, signal);
    const results = Promise.allSettled([first, duplicate]);
    controller.abort();
    pending.resolve({status: "not_published", reason: "policy_declined"});
    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  });

  it("waits for the matching head when attributes arrive first", async () => {
    const {consumer, head, attributes, run, signal} = setup();
    expect(await consumer.onEvent(attributes, signal)).toMatchObject({reason: "awaiting_matching_head"});
    expect(run).not.toHaveBeenCalled();
    await consumer.onEvent(head, signal);
    expect(run).toHaveBeenCalledOnce();
  });

  it("waits for a branch-matching preference rather than using the latest preference", async () => {
    const {consumer, head, attributes, tracker, preference, run, signal} = setup(10, false);
    const wrong = ssz.gloas.SignedProposerPreferences.clone(preference);
    wrong.message.dependentRoot = Buffer.alloc(32, 99);
    tracker.onProposerPreferences(wrong);
    await consumer.onEvent(head, signal);
    expect(await consumer.onEvent(attributes, signal)).toMatchObject({reason: "awaiting_preference"});
    expect(run).not.toHaveBeenCalled();
    tracker.onProposerPreferences(preference);
    await consumer.onEvent(
      {type: routes.events.EventType.proposerPreferences, message: {version: ForkName.gloas, data: preference}},
      signal
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it.each(["slot", "parent", "timestamp", "safe", "finalized", "validator", "gas_limit"] as const)(
    "does not prepare with mismatched or missing %s input",
    async (field) => {
      const {consumer, head, attributes, preference, run, signal} = setup();
      const data = attributes.message.data;
      switch (field) {
        case "slot":
          data.payloadAttributes.slotNumber++;
          break;
        case "parent":
          data.payloadAttributes.parentBeaconBlockRoot = Buffer.alloc(32, 99);
          break;
        case "timestamp":
          data.payloadAttributes.timestamp++;
          break;
        case "safe":
          Reflect.deleteProperty(data, "safeBlockHash");
          break;
        case "finalized":
          Reflect.deleteProperty(data, "finalizedBlockHash");
          break;
        case "validator":
          preference.message.validatorIndex++;
          break;
        case "gas_limit":
          preference.message.targetGasLimit++;
          break;
      }
      await consumer.onEvent(head, signal);
      expect(await consumer.onEvent(attributes, signal)).toMatchObject({status: "ignored"});
      expect(run).not.toHaveBeenCalled();
    }
  );

  it("rejects Heze rather than inventing inclusion-list bid bits", async () => {
    const {consumer, head, attributes, run, signal} = setup();
    await consumer.onEvent(head, signal);
    expect(
      await consumer.onEvent({...attributes, message: {...attributes.message, version: ForkName.heze}}, signal)
    ).toMatchObject({reason: "unsupported_fork"});
    expect(run).not.toHaveBeenCalled();
  });

  it("suppresses duplicates but preserves distinct FULL/EMPTY execution parents", async () => {
    const {consumer, head, attributes, run, signal} = setup();
    await consumer.onEvent(head, signal);
    await consumer.onEvent(attributes, signal);
    expect(await consumer.onEvent(attributes, signal)).toMatchObject({reason: "duplicate_input"});
    attributes.message.data.parentBlockHash = Buffer.alloc(32, 22);
    await consumer.onEvent(attributes, signal);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0].job.id).not.toBe(run.mock.calls[1][0].job.id);
    expect(run.mock.calls[1][0].job.request.forkchoiceState.headBlockHash).toBe(toRootHex(Buffer.alloc(32, 22)));
  });

  it.each(["head_change", "slot_change", "shutdown", "replacement"] as const)(
    "cancels outstanding work on %s and rejects its late result",
    async (reason) => {
      const {consumer, head, attributes, run, controller, signal, clock} = setup();
      const result = defer<SlotBidResult>();
      run.mockReturnValueOnce(result.promise);
      await consumer.onEvent(head, signal);
      const pending = consumer.onEvent(attributes, signal);
      const aborted = expect(pending).rejects.toThrow();
      const jobSignal = run.mock.calls[0][1];
      if (reason === "head_change") {
        await consumer.onEvent(
          {...head, message: {...head.message, data: {...head.message.data, block: toRootHex(Buffer.alloc(32, 99))}}},
          signal
        );
      } else if (reason === "slot_change") {
        clock.currentSlot++;
        consumer.onSlot(clock.currentSlot);
      } else if (reason === "shutdown") {
        controller.abort();
      } else {
        attributes.message.data.parentBlockHash = Buffer.alloc(32, 22);
        await consumer.onEvent(attributes, signal);
      }
      expect(jobSignal.aborted).toBe(true);
      result.resolve({status: "not_published", reason: "policy_declined"});
      await aborted;
    }
  );

  it("bounds distinct inputs per slot", async () => {
    const {consumer, head, attributes, run, signal} = setup();
    await consumer.onEvent(head, signal);
    for (let i = 0; i < 3; i++) {
      attributes.message.data.parentBlockHash = Buffer.alloc(32, 20 + i);
      await consumer.onEvent(attributes, signal);
    }
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rejects late attributes before starting a job", async () => {
    const {consumer, head, attributes, run, signal, clock} = setup();
    await consumer.onEvent(head, signal);
    clock.msToSlot = () => 1;
    expect(await consumer.onEvent(attributes, signal)).toMatchObject({reason: "deadline_passed"});
    expect(run).not.toHaveBeenCalled();
  });

  it.each([5000, 9000])("checks deadline %s against the real clock at BN preparation time", async (deadlineBps) => {
    const {config, tracker, run, head, attributes, signal, executionFeeRecipient} = setup();
    const currentSlot = attributes.message.data.proposalSlot - 1;
    const slotStart = computeTimeAtSlot(config, currentSlot, 0) * 1000;
    vi.setSystemTime(slotStart + config.getSlotComponentDurationMs(6667));
    const clock = new Clock(config, getMockedLogger(), {genesisTime: 0});
    const consumer = new PayloadAttributesConsumer(
      {config, clock, preferences: tracker, bidder: {run}},
      {executionFeeRecipient, deadlineBps, maxInputsPerSlot: 2}
    );
    await consumer.onEvent(head, signal);
    const result = await consumer.onEvent(attributes, signal);
    if (deadlineBps === 5000) {
      expect(result).toMatchObject({reason: "deadline_passed"});
      expect(run).not.toHaveBeenCalled();
    } else {
      expect(result).toMatchObject({status: "published"});
      expect(run.mock.calls[0][0].job.getPayloadAt).toBe(slotStart + config.getSlotComponentDurationMs(deadlineBps));
    }
  });
});

function setup(slot = 10, withPreference = true) {
  const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 1));
  const clock = new ClockMock();
  clock.currentSlot = slot - 1;
  const api = getApiClientStub();
  const tracker = new ProposerPreferencesTracker();
  const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
  data.proposalSlot = slot;
  data.proposerIndex = 7;
  data.parentBlockRoot = Buffer.alloc(32, 2);
  data.parentBlockHash = Buffer.alloc(32, 3);
  data.safeBlockHash = Buffer.alloc(32, 4);
  data.finalizedBlockHash = Buffer.alloc(32, 5);
  data.payloadAttributes.slotNumber = slot;
  data.payloadAttributes.parentBeaconBlockRoot = data.parentBlockRoot;
  data.payloadAttributes.timestamp = (slot * config.SLOT_DURATION_MS) / 1000;
  data.payloadAttributes.targetGasLimit = 30_000_000n;
  const preference = ssz.gloas.SignedProposerPreferences.defaultValue();
  preference.message.proposalSlot = slot;
  preference.message.validatorIndex = data.proposerIndex;
  preference.message.targetGasLimit = data.payloadAttributes.targetGasLimit;
  preference.message.feeRecipient = Buffer.alloc(20, 8);
  const currentRoot = Buffer.alloc(32, 6);
  const nextRoot = Buffer.alloc(32, 7);
  preference.message.dependentRoot = slot % SLOTS_PER_EPOCH === 0 ? nextRoot : currentRoot;
  if (withPreference) tracker.onProposerPreferences(preference);
  const head = {
    type: routes.events.EventType.headV2,
    message: {
      version: ForkName.gloas,
      data: {
        slot: slot - 1,
        block: toRootHex(data.parentBlockRoot),
        state: toRootHex(Buffer.alloc(32)),
        payloadStatus: "full",
        epochTransition: false,
        currentEpochDependentRoot: toRootHex(currentRoot),
        nextEpochDependentRoot: toRootHex(nextRoot),
        executionOptimistic: false,
      },
    },
  } satisfies routes.events.BeaconEvent;
  const attributes = {
    type: routes.events.EventType.payloadAttributes,
    message: {version: ForkName.gloas, data},
  } satisfies routes.events.BeaconEvent;
  const run = vi.fn<SlotBidder["run"]>().mockResolvedValue({
    status: "published",
    blockHash: toRootHex(Buffer.alloc(32, 9)),
    sourceId: "engine",
    valueGwei: 1,
  });
  const executionFeeRecipient = Buffer.alloc(20, 9);
  const consumer = new PayloadAttributesConsumer(
    {config, clock, preferences: tracker, bidder: {run}},
    {executionFeeRecipient, deadlineBps: 9000, maxInputsPerSlot: 2}
  );
  const controller = new AbortController();
  return {
    api,
    config,
    clock,
    tracker,
    preference,
    consumer,
    head,
    attributes,
    run,
    controller,
    signal: controller.signal,
    executionFeeRecipient,
  };
}
