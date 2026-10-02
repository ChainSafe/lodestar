import {describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {BitArray} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, INCLUSION_LIST_COMMITTEE_SIZE, MIN_DEPOSIT_AMOUNT} from "@lodestar/params";
import type {RootHex, heze} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {type BidPolicy, ProportionalBidPolicy} from "../../../src/services/bidPolicy.js";
import {BidPublisher} from "../../../src/services/bidPublisher.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {ExecutionPayloadBidErrorCode} from "../../../src/services/executionPayloadBid.js";
import type {BuiltPayload} from "../../../src/services/payloadSource.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {
  type GloasSlotBidInput,
  type HezeSlotBidInput,
  SlotBidder,
  SlotBidderError,
  SlotBidderErrorCode,
  type SlotBidderModules,
} from "../../../src/services/slotBidder.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";

const SLOT = 64;
const PARENT_BLOCK_ROOT = Buffer.alloc(32, 1);
const PARENT_BLOCK_HASH = toRootHex(Buffer.alloc(32, 2));
const BLOCK_HASH = toRootHex(Buffer.alloc(32, 3));
const FEE_RECIPIENT = Buffer.alloc(20, 4);

describe("SlotBidder", () => {
  it("uses retained proposer preferences without mutating the value", async () => {
    const tracker = new ProposerPreferencesTracker();
    const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
    signed.message.proposalSlot = SLOT;
    signed.message.dependentRoot = Buffer.alloc(32, 5);
    signed.message.feeRecipient = Uint8Array.from(FEE_RECIPIENT);
    const dependentRoot = toRootHex(signed.message.dependentRoot);
    const original = ssz.gloas.SignedProposerPreferences.serialize(signed);
    tracker.onProposerPreferences(signed);

    const preferences = tracker.get(SLOT, dependentRoot);
    if (preferences === null) throw Error("Expected retained preferences");
    const input = {...gloasInput(), proposerFeeRecipient: preferences.message.feeRecipient};
    const {bidder, publish} = setup(builtPayload(ForkName.gloas));

    await bidder.run(input, new AbortController().signal);

    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][0].feeRecipient).toEqual(Uint8Array.from(FEE_RECIPIENT));
    expect(ssz.gloas.SignedProposerPreferences.serialize(preferences)).toEqual(original);
  });

  it.each([-1n, -999_999_999n, -1_000_000_000n, (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000_000n])(
    "rejects invalid payload value %s before policy or retention",
    async (executionPayloadValue) => {
      const payload = builtPayload(ForkName.gloas);
      payload.executionPayloadValue = executionPayloadValue;
      const {bidder, modules, publish, store} = setup(payload);

      await expectSlotBidderError(bidder.run(gloasInput(), new AbortController().signal), {
        code: SlotBidderErrorCode.UNSAFE_PAYLOAD_VALUE,
        executionPayloadValue,
      });
      expect(modules.policy.computeValue).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
      expect(publish).not.toHaveBeenCalled();
    }
  );

  it.each([
    [0n, 0],
    [1n, 0],
    [999_999_999n, 0],
    [1_000_000_000n, 1],
    [BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000_000n + 999_999_999n, Number.MAX_SAFE_INTEGER],
  ] as const)("converts valid payload value %s to %s Gwei", async (executionPayloadValue, payloadValueGwei) => {
    const payload = builtPayload(ForkName.gloas);
    payload.executionPayloadValue = executionPayloadValue;
    const {bidder, modules} = setup(payload);

    await bidder.run(gloasInput(), new AbortController().signal);
    expect(modules.policy.computeValue).toHaveBeenCalledWith({payloadValueGwei, coverableGwei: 100});
  });

  it("builds, retains, and publishes one Gloas bid", async () => {
    const payload = builtPayload(ForkName.gloas);
    const {bidder, modules, publish, store} = setup(payload);
    const add = vi.spyOn(store, "add");

    const result = await bidder.run(gloasInput(), new AbortController().signal);

    expect(result).toEqual({status: "published", blockHash: BLOCK_HASH, sourceId: "engine-0", valueGwei: 7});
    expect(modules.buildPayload).toHaveBeenCalledOnce();
    expect(modules.policy.computeValue).toHaveBeenCalledWith({payloadValueGwei: 10, coverableGwei: 100});
    expect(store.get(BLOCK_HASH)?.payload).toBe(payload);
    expect(add).toHaveBeenCalledWith({slot: SLOT, parentBlockRoot: PARENT_BLOCK_ROOT, blockHash: BLOCK_HASH, payload});
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][0]).toMatchObject({
      slot: SLOT,
      parentBlockRoot: PARENT_BLOCK_ROOT,
      blockHash: Buffer.alloc(32, 3),
      feeRecipient: FEE_RECIPIENT,
      builderIndex: 9,
      value: 7,
      executionPayment: 0n,
    });
  });

  it("preserves Heze inclusion-list bits", async () => {
    const payload = builtPayload(ForkName.heze);
    const inclusionListBits = ssz.heze.ExecutionPayloadBid.defaultValue().inclusionListBits;
    inclusionListBits.set(2, true);
    const {bidder, publish} = setup(payload);

    await bidder.run(hezeInput(inclusionListBits), new AbortController().signal);

    const bid = publish.mock.calls[0][0] as heze.ExecutionPayloadBid;
    expect(bid.inclusionListBits).toBe(inclusionListBits);
  });

  it.each([
    [{status: undefined, balance: undefined}, "unknown_status"],
    [{status: "pending" as const, balance: MIN_DEPOSIT_AMOUNT + 100}, "inactive"],
    [{status: "active" as const, balance: MIN_DEPOSIT_AMOUNT - 1}, "low_balance"],
  ])("does not publish when Builder state is unavailable", async (builderStatus, reason) => {
    const {bidder, publish, store} = setup(builtPayload(ForkName.gloas), {builderStatus});

    await expect(bidder.run(gloasInput(), new AbortController().signal)).resolves.toEqual({
      status: "not_published",
      reason,
    });
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not retain or publish when policy declines", async () => {
    const {bidder, modules, publish, store} = setup(builtPayload(ForkName.gloas), {policyValue: null});

    await expect(bidder.run(gloasInput(), new AbortController().signal)).resolves.toEqual({
      status: "not_published",
      reason: "policy_declined",
    });
    expect(modules.policy.computeValue).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([ForkName.gloas, ForkName.heze] as const)("publishes with the proportional policy in %s", async (fork) => {
    const payload = fork === ForkName.heze ? builtPayload(ForkName.heze) : builtPayload(ForkName.gloas);
    const {bidder, modules, publish, store} = setup(payload);
    modules.policy = new ProportionalBidPolicy({shareBps: 5000, fixedCostGwei: 0, minValueGwei: 0});
    const input =
      fork === ForkName.heze ? hezeInput(ssz.heze.ExecutionPayloadBid.defaultValue().inclusionListBits) : gloasInput();

    await expect(bidder.run(input, new AbortController().signal)).resolves.toEqual({
      status: "published",
      blockHash: BLOCK_HASH,
      sourceId: "engine-0",
      valueGwei: 5,
    });
    expect(store.get(BLOCK_HASH)).not.toBeNull();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][0].value).toBe(5);
  });

  it("does not retain or publish when the proportional policy minimum exceeds coverable balance", async () => {
    const {bidder, modules, publish, store} = setup(builtPayload(ForkName.gloas));
    modules.policy = new ProportionalBidPolicy({shareBps: 5000, fixedCostGwei: 0, minValueGwei: 101});

    await expect(bidder.run(gloasInput(), new AbortController().signal)).resolves.toEqual({
      status: "not_published",
      reason: "policy_declined",
    });
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, 0.5])("rejects an invalid injected policy result %s", async (policyValue) => {
    const {bidder, publish, store} = setup(builtPayload(ForkName.gloas), {policyValue});

    await expect(bidder.run(gloasInput(), new AbortController().signal)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.INVALID_VALUE, value: policyValue},
    });
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not rebuild or republish a submitted variant", async () => {
    const input = gloasInput();
    const ledger = new BidLedger();
    ledger.recordBid({
      slot: input.slot,
      parentBlockHash: input.job.request.forkchoiceState.headBlockHash,
      parentBlockRoot: toRootHex(input.parentBlockRoot),
      blockHash: BLOCK_HASH,
      valueGwei: 7,
      signedBidRoot: rootHex(5),
    });
    const {bidder, modules, publish, store} = setup(builtPayload(ForkName.gloas), {ledger});

    await expect(bidder.run(input, new AbortController().signal)).resolves.toEqual({
      status: "not_published",
      reason: "already_submitted",
    });
    expect(modules.buildPayload).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  describe.each([ForkName.gloas, ForkName.heze] as const)("%s coverability", (fork) => {
    it.each([
      {reserve: 0, unsettled: 0, coverable: 100},
      {reserve: 25, unsettled: 40, coverable: 35},
      {reserve: 0, unsettled: 100, coverable: 0},
    ])(
      "enforces the policy limit with reserve $reserve and unsettled $unsettled",
      async ({reserve, unsettled, coverable}) => {
        const ledger = new BidLedger();
        const prior = {
          slot: SLOT,
          parentBlockHash: rootHex(6),
          parentBlockRoot: rootHex(7),
          blockHash: rootHex(8),
          signedBidRoot: rootHex(5),
        };
        ledger.recordBid({...prior, valueGwei: unsettled});
        ledger.recordWin(prior, rootHex(9));
        const payload = fork === ForkName.heze ? builtPayload(ForkName.heze) : builtPayload(ForkName.gloas);
        const input =
          fork === ForkName.heze
            ? hezeInput(ssz.heze.ExecutionPayloadBid.defaultValue().inclusionListBits)
            : gloasInput();
        const {bidder, modules, publish, store} = setup(payload, {
          ledger,
          minOperatingBalanceGwei: MIN_DEPOSIT_AMOUNT + reserve,
          policyValue: coverable + 1,
        });
        const add = vi.spyOn(store, "add");

        await expectSlotBidderError(bidder.run(input, new AbortController().signal), {
          code: SlotBidderErrorCode.UNCOVERED_BID,
          valueGwei: coverable + 1,
          coverableGwei: coverable,
        });
        expect(add).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(ledger.hasSubmitted(input.slot, PARENT_BLOCK_HASH, toRootHex(PARENT_BLOCK_ROOT))).toBe(false);

        vi.mocked(modules.policy.computeValue).mockReturnValue(coverable);
        await expect(bidder.run(input, new AbortController().signal)).resolves.toMatchObject({
          status: "published",
          valueGwei: coverable,
        });
        expect(add).toHaveBeenCalledOnce();
        expect(publish).toHaveBeenCalledOnce();
      }
    );
  });

  it("publishes only once when duplicate calls share an in-flight build", async () => {
    const input = gloasInput();
    const {bidder, publish} = setup(builtPayload(ForkName.gloas));

    const results = await Promise.all([
      bidder.run(input, new AbortController().signal),
      bidder.run(input, new AbortController().signal),
    ]);

    expect(results).toEqual([
      {status: "published", blockHash: BLOCK_HASH, sourceId: "engine-0", valueGwei: 7},
      {status: "not_published", reason: "already_submitted"},
    ]);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("subtracts unsettled wins from coverable balance", async () => {
    const ledger = new BidLedger();
    const prior = {
      slot: SLOT,
      parentBlockHash: rootHex(6),
      parentBlockRoot: rootHex(7),
      blockHash: rootHex(8),
      signedBidRoot: rootHex(5),
    };
    ledger.recordBid({...prior, valueGwei: 40});
    ledger.recordWin(prior, rootHex(9));
    const {bidder, modules} = setup(builtPayload(ForkName.gloas), {ledger});

    await bidder.run(gloasInput(), new AbortController().signal);

    expect(modules.policy.computeValue).toHaveBeenCalledWith({payloadValueGwei: 10, coverableGwei: 60});
  });

  it("preserves the configured operating balance when computing coverable value", async () => {
    const minOperatingBalanceGwei = MIN_DEPOSIT_AMOUNT + 25;
    const {bidder, modules} = setup(builtPayload(ForkName.gloas), {
      builderStatus: {status: "active", balance: minOperatingBalanceGwei + 100},
      minOperatingBalanceGwei,
    });

    await bidder.run(gloasInput(), new AbortController().signal);

    expect(modules.policy.computeValue).toHaveBeenCalledWith({payloadValueGwei: 10, coverableGwei: 100});
  });

  it("rejects a request for a different fork before preparing a payload", async () => {
    const input = gloasInput();
    input.job.request.fork = ForkName.heze;
    const {bidder, modules} = setup(builtPayload(ForkName.gloas));

    await expectSlotBidderError(bidder.run(input, new AbortController().signal), {
      code: SlotBidderErrorCode.INPUT_FORK_MISMATCH,
      fork: ForkName.gloas,
      requestFork: ForkName.heze,
    });
    expect(modules.buildPayload).not.toHaveBeenCalled();
  });

  it("rejects an input whose slot does not match its payload attributes", async () => {
    const input = gloasInput();
    input.job.request.payloadAttributes.slotNumber++;
    const {bidder, modules} = setup(builtPayload(ForkName.gloas));

    await expectSlotBidderError(bidder.run(input, new AbortController().signal), {
      code: SlotBidderErrorCode.SLOT_MISMATCH,
      slot: SLOT,
      requestSlot: SLOT + 1,
    });
    expect(modules.buildPayload).not.toHaveBeenCalled();
  });

  it("rejects an input whose parent root does not match its payload attributes", async () => {
    const input = gloasInput();
    input.job.request.payloadAttributes.parentBeaconBlockRoot = Buffer.alloc(32, 5);
    const {bidder, modules} = setup(builtPayload(ForkName.gloas));

    await expectSlotBidderError(bidder.run(input, new AbortController().signal), {
      code: SlotBidderErrorCode.PARENT_ROOT_MISMATCH,
      parentBlockRoot: toRootHex(PARENT_BLOCK_ROOT),
      requestParentBlockRoot: rootHex(5),
    });
    expect(modules.buildPayload).not.toHaveBeenCalled();
  });

  it("rejects a payload built on another parent", async () => {
    const payload = builtPayload(ForkName.gloas);
    payload.executionPayload.parentHash = Buffer.alloc(32, 6);
    const {bidder, publish, store} = setup(payload);

    await expectSlotBidderError(bidder.run(gloasInput(), new AbortController().signal), {
      code: SlotBidderErrorCode.PAYLOAD_PARENT_MISMATCH,
      expectedParentBlockHash: PARENT_BLOCK_HASH,
      payloadParentBlockHash: rootHex(6),
    });
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([ForkName.gloas, ForkName.heze] as const)(
    "rejects a %s payload with different prevRandao before retention or publication",
    async (fork) => {
      const payload = builtPayload(fork);
      payload.executionPayload.prevRandao = Buffer.alloc(32, 6);
      const input =
        fork === ForkName.heze ? hezeInput(BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE)) : gloasInput();
      const {bidder, publish, store} = setup(payload);

      await expect(bidder.run(input, new AbortController().signal)).rejects.toMatchObject({
        type: {code: ExecutionPayloadBidErrorCode.PREV_RANDAO_MISMATCH},
      });
      expect(store.size).toBe(0);
      expect(publish).not.toHaveBeenCalled();
    }
  );

  it.each([1, INCLUSION_LIST_COMMITTEE_SIZE + 1])(
    "rejects Heze inclusion-list bit length %s before retention or publication",
    async (bitLen) => {
      const {bidder, publish, store} = setup(builtPayload(ForkName.heze));
      const input = hezeInput(BitArray.fromBitLen(bitLen));

      await expect(bidder.run(input, new AbortController().signal)).rejects.toMatchObject({
        type: {code: ExecutionPayloadBidErrorCode.INVALID_INCLUSION_LIST_BITS, bitLen},
      });
      expect(store.size).toBe(0);
      expect(publish).not.toHaveBeenCalled();
    }
  );

  it("publishes a payload matching the BN-provided prevRandao", async () => {
    const input = gloasInput();
    input.job.request.payloadAttributes.prevRandao = Buffer.alloc(32, 7);
    const payload = builtPayload(ForkName.gloas);
    payload.executionPayload.prevRandao = Uint8Array.from(input.job.request.payloadAttributes.prevRandao);
    const {bidder, publish} = setup(payload);

    await bidder.run(input, new AbortController().signal);

    expect(publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({prevRandao: input.job.request.payloadAttributes.prevRandao}),
      expect.any(AbortSignal)
    );
  });

  it("rejects a payload equal to its parent before retention or publication", async () => {
    const payload = builtPayload(ForkName.gloas);
    payload.executionPayload.blockHash = payload.executionPayload.parentHash.slice();
    const {bidder, publish, store} = setup(payload);

    await expect(bidder.run(gloasInput(), new AbortController().signal)).rejects.toMatchObject({
      type: {code: ExecutionPayloadBidErrorCode.BLOCK_HASH_EQUALS_PARENT},
    });
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a payload whose fork does not match the requested fork", async () => {
    const {bidder, publish, store} = setup(builtPayload(ForkName.heze));

    await expectSlotBidderError(bidder.run(gloasInput(), new AbortController().signal), {
      code: SlotBidderErrorCode.PAYLOAD_FORK_MISMATCH,
      fork: ForkName.gloas,
      payloadFork: ForkName.heze,
    });
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a payload value that cannot be represented safely in Gwei", async () => {
    const payload = builtPayload(ForkName.gloas);
    payload.executionPayloadValue = (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000_000n;
    const {bidder, publish, store} = setup(payload);

    await expectSlotBidderError(bidder.run(gloasInput(), new AbortController().signal), {
      code: SlotBidderErrorCode.UNSAFE_PAYLOAD_VALUE,
      executionPayloadValue: payload.executionPayloadValue,
    });
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("forwards cancellation to the payload orchestrator", async () => {
    const controller = new AbortController();
    const {bidder, modules} = setup(builtPayload(ForkName.gloas));
    controller.abort();

    await expect(bidder.run(gloasInput(), controller.signal)).rejects.toMatchObject({name: "AbortError"});
    expect(modules.buildPayload).not.toHaveBeenCalled();
  });

  it("rejects a late payload before pricing, retention or publication after cancellation", async () => {
    const controller = new AbortController();
    const {bidder, modules, publish, store} = setup(builtPayload(ForkName.gloas));
    vi.mocked(modules.buildPayload).mockImplementation(async () => {
      controller.abort();
      return builtPayload(ForkName.gloas);
    });

    await expect(bidder.run(gloasInput(), controller.signal)).rejects.toMatchObject({name: "AbortError"});
    expect(modules.policy.computeValue).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([MIN_DEPOSIT_AMOUNT - 1, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid minimum operating balance %s",
    (minOperatingBalanceGwei) => {
      const {modules} = setupModules(builtPayload(ForkName.gloas));
      expect(() => new SlotBidder(modules, {minOperatingBalanceGwei})).toThrowError(SlotBidderError);
    }
  );
});

function setup(
  payload: BuiltPayload,
  opts: {
    builderStatus?: ReturnType<SlotBidderModules["getBuilderStatus"]>;
    policyValue?: number | null;
    ledger?: BidLedger;
    minOperatingBalanceGwei?: number;
  } = {}
) {
  const {modules, publish, store} = setupModules(payload, opts);
  return {
    bidder: new SlotBidder(modules, {minOperatingBalanceGwei: opts.minOperatingBalanceGwei ?? MIN_DEPOSIT_AMOUNT}),
    modules,
    publish,
    store,
  };
}

function setupModules(
  payload: BuiltPayload,
  opts: {
    builderStatus?: ReturnType<SlotBidderModules["getBuilderStatus"]>;
    policyValue?: number | null;
    ledger?: BidLedger;
  } = {}
) {
  const buildPayload = vi.fn<SlotBidderModules["buildPayload"]>().mockResolvedValue(payload);
  const store = new PayloadStore();
  const policy = {
    computeValue: vi
      .fn<BidPolicy["computeValue"]>()
      .mockReturnValue(opts.policyValue === undefined ? 7 : opts.policyValue),
  };
  const ledger = opts.ledger ?? new BidLedger();
  const api = getApiClientStub();
  Object.assign(api.beacon, {publishExecutionPayloadBid: vi.fn()});
  const config = createBeaconConfig(getConfig(payload.fork), Buffer.alloc(32, 1));
  const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
  const signer = new BuilderSigner(config, {secretKey, publicKey: secretKey.toPublicKey()});
  api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
  const publisher = new BidPublisher({
    api,
    config,
    signer,
    ledger,
    builderIndex: 9,
    hasPayload: (identity) => store.get(identity.blockHash) !== null,
  });
  const publish = vi.spyOn(publisher, "publish");
  const modules: SlotBidderModules = {
    buildPayload,
    store,
    policy,
    ledger,
    publisher,
    getBuilderStatus: () => opts.builderStatus ?? {status: "active", balance: MIN_DEPOSIT_AMOUNT + 100},
    builderIndex: 9,
  };
  return {modules, publish, store};
}

function gloasInput(): GloasSlotBidInput {
  const payloadAttributes = ssz.gloas.PayloadAttributes.defaultValue();
  payloadAttributes.slotNumber = SLOT;
  payloadAttributes.parentBeaconBlockRoot = PARENT_BLOCK_ROOT;
  return {
    fork: ForkName.gloas,
    slot: SLOT,
    parentBlockRoot: PARENT_BLOCK_ROOT,
    proposerFeeRecipient: FEE_RECIPIENT,
    job: {
      id: "slot-64-gloas",
      request: {
        fork: ForkName.gloas,
        forkchoiceState: {
          headBlockHash: PARENT_BLOCK_HASH,
          safeBlockHash: rootHex(10),
          finalizedBlockHash: rootHex(11),
        },
        payloadAttributes,
      },
      getPayloadAt: 1_000,
    },
  };
}

function hezeInput(inclusionListBits: heze.ExecutionPayloadBid["inclusionListBits"]): HezeSlotBidInput {
  const payloadAttributes = ssz.heze.PayloadAttributes.defaultValue();
  payloadAttributes.slotNumber = SLOT;
  payloadAttributes.parentBeaconBlockRoot = PARENT_BLOCK_ROOT;
  return {
    fork: ForkName.heze,
    slot: SLOT,
    parentBlockRoot: PARENT_BLOCK_ROOT,
    proposerFeeRecipient: FEE_RECIPIENT,
    inclusionListBits,
    job: {
      id: "slot-64-heze",
      request: {
        fork: ForkName.heze,
        forkchoiceState: {
          headBlockHash: PARENT_BLOCK_HASH,
          safeBlockHash: rootHex(10),
          finalizedBlockHash: rootHex(11),
        },
        payloadAttributes,
      },
      getPayloadAt: 1_000,
    },
  };
}

function builtPayload(fork: ForkName.gloas | ForkName.heze): BuiltPayload {
  if (fork === ForkName.heze) {
    const executionPayload = ssz.heze.ExecutionPayload.defaultValue();
    executionPayload.slotNumber = SLOT;
    executionPayload.parentHash = Buffer.alloc(32, 2);
    executionPayload.blockHash = Buffer.alloc(32, 3);
    return {
      sourceId: "engine-0",
      fork,
      executionPayload,
      executionRequests: ssz.heze.ExecutionRequests.defaultValue(),
      blobsBundle: ssz.heze.BlobsBundle.defaultValue(),
      executionPayloadValue: 10_000_000_000n,
    };
  }

  const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
  executionPayload.slotNumber = SLOT;
  executionPayload.parentHash = Buffer.alloc(32, 2);
  executionPayload.blockHash = Buffer.alloc(32, 3);
  return {
    sourceId: "engine-0",
    fork,
    executionPayload,
    executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    blobsBundle: ssz.gloas.BlobsBundle.defaultValue(),
    executionPayloadValue: 10_000_000_000n,
  };
}

async function expectSlotBidderError(promise: Promise<unknown>, type: SlotBidderError["type"]): Promise<void> {
  try {
    await promise;
    throw Error("Expected SlotBidderError");
  } catch (error) {
    if (!(error instanceof SlotBidderError)) {
      throw error;
    }
    expect(error.type).toEqual(type);
  }
}

function rootHex(value: number): RootHex {
  return toRootHex(Buffer.alloc(32, value));
}
