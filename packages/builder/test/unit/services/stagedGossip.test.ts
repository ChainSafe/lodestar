import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {BuilderStatus, gloas, ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {BidLedger, BidLedgerErrorCode} from "../../../src/services/bidLedger.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {CommitmentJournal} from "../../../src/services/commitmentJournal.js";
import {CommitmentJournalError} from "../../../src/services/commitmentJournalError.js";
import {
  GossipStage,
  assertGossipJournalsConfigured,
  getMinGossipBidValue,
  gossipJournalDirectory,
  validateGossipStages,
} from "../../../src/services/gossipStages.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {createBiddingModules, getPayloadSourceStub} from "../utils/bidding.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockBuiltPayload} from "../utils/payload.js";

const config = getConfig(ForkName.gloas);
const parentHash = Buffer.alloc(32, 5);
const parentRoot = Buffer.alloc(32, 4);
const dependentRoot = Buffer.alloc(32, 7);
const prevRandao = Buffer.alloc(32, 6);
const slot = 1;
const updateOptions = {updateIntervalMs: 100, updateCutoffBps: 1000};

describe("staged P2P gossip", () => {
  let api: ReturnType<typeof getApiClientStub>;
  let logger: ReturnType<typeof getMockedLogger>;
  let source: ReturnType<typeof getPayloadSourceStub>;
  let payloadStore: PayloadStore;
  let preferences: ProposerPreferencesTracker;
  let controller: AbortController;
  let clock: ClockMock;
  let directory: string;

  beforeEach(() => {
    vi.useFakeTimers({now: 0});
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-staged-gossip-"));
    api = getApiClientStub();
    logger = getMockedLogger();
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({data: [], meta: {executionOptimistic: false, dependentRoot: toRootHex(dependentRoot)}})
    );
    api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));
    source = getPayloadSourceStub();
    source.supportsUpdates = true;
    source.prepare.mockResolvedValue({sourceId: "el", fork: ForkName.gloas, payloadId: "0x01"});
    source.getPayload.mockImplementation(async () => payload(Date.now() >= 11800 ? 3 : Date.now() >= 10800 ? 2 : 1));
    payloadStore = new PayloadStore();
    preferences = new ProposerPreferencesTracker();
    const pref = ssz.gloas.SignedProposerPreferences.defaultValue();
    pref.message.proposalSlot = slot;
    pref.message.dependentRoot = dependentRoot;
    pref.message.feeRecipient = Buffer.alloc(20, 8);
    pref.message.targetGasLimit = 30_000_000n;
    preferences.onProposerPreferences(pref);
    controller = new AbortController();
    clock = new ClockMock();
    clock.msToSlot = (target) => target * 12000 - Date.now();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(directory, {recursive: true, force: true});
  });

  function payload(revision: number, valueGwei = revision * 1_000_000_000) {
    return {
      ...mockBuiltPayload({slot, parentHash, prevRandao, blockHash: Buffer.alloc(32, 10 + revision), valueGwei}),
      fork: ForkName.gloas as const,
    };
  }

  function event() {
    const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
    data.proposalSlot = slot;
    data.parentBlockRoot = parentRoot;
    data.parentBlockHash = parentHash;
    data.payloadAttributes.prevRandao = prevRandao;
    return {version: ForkName.gloas as const, data};
  }

  function identity(
    index: number,
    gossipStages: GossipStage[] = [],
    options: {
      status?: BuilderStatus;
      balance?: number;
      durable?: boolean;
      updateIntervalMs?: number;
      deferUnusedGossipStages?: boolean;
      retain?: (bid: gloas.SignedExecutionPayloadBid) => Promise<void>;
    } = {}
  ) {
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, index));
    const signer = new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), {
      secretKey,
      publicKey: secretKey.toPublicKey(),
    });
    const journalIdentity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32)), pubkey: signer.getPubkeyHex()};
    const journal = options.durable
      ? new CommitmentJournal(path.join(directory, String(index)), journalIdentity, 0)
      : undefined;
    const getBuilderStatus = () => ({
      status: options.status ?? ("active" as const),
      balance: options.balance ?? 10_000_000_000,
    });
    const modules = createBiddingModules({
      api,
      config,
      logger,
      clock,
      builderSigner: signer,
      proposerPreferencesTracker: preferences,
      payloadStore,
      payloadSource: source,
      signal: controller.signal,
      index,
      updateOptions: {
        ...updateOptions,
        updateIntervalMs: options.updateIntervalMs ?? updateOptions.updateIntervalMs,
        deferUnusedGossipStages: options.deferUnusedGossipStages,
      },
      gossipStages,
      getBuilderStatus,
      retainCommitment:
        options.retain ??
        (journal
          ? async (bid, offered) => {
              const stored = offered;
              if (!stored) throw Error("missing test offer");
              journal.retain(bid, stored);
            }
          : undefined),
    });
    return {
      ...modules,
      signer,
      journalIdentity,
      journal,
      stage: {
        deadlineBps: index === 2 ? 9250 : 10000,
        builderIndex: index,
        ledger: modules.ledger,
        bidStore: modules.bidStore,
        bidPublisher: modules.bidPublisher,
        getBuilderStatus,
      } satisfies GossipStage,
    };
  }

  function published() {
    return api.beacon.publishExecutionPayloadBid.mock.calls.map(([request]) => request.signedExecutionPayloadBid);
  }

  it.each([2, 3])("journals current owner membership through the primary and stage %i", async (index) => {
    const oldId = `0x${"11".repeat(32)}`;
    const newId = `0x${"22".repeat(32)}`;
    const lease = {generation: "0x0", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity};
    source.getPayload.mockImplementation(async () => ({
      ...payload(1),
      orderMetadata: {version: 1, orderIds: [lease.generation === "0x0" ? oldId : newId], doNotOfferBefore: 0},
      offerEligibility: {generation: lease.generation, lease},
    }));
    const stage = identity(index, [], {durable: true});
    const primary = identity(1, [stage.stage], {durable: true});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(200);
    expect(primary.journal?.queryExposure(oldId, Date.now()).commitmentCount).toBe(1);
    expect(primary.journal?.queryExposure(newId, Date.now()).commitmentCount).toBe(0);
    lease.generation = "0x1";
    await vi.advanceTimersByTimeAsync(200);
    expect(primary.journal?.queryExposure(newId, Date.now()).commitmentCount).toBe(1);
    await vi.advanceTimersByTimeAsync(9700);
    lease.ready = false;
    const stageAt = index === 2 ? 11100 : 12000;
    await vi.advanceTimersByTimeAsync(stageAt - 10100 - 1);
    expect(published()).toHaveLength(0);
    lease.ready = true;
    await vi.advanceTimersByTimeAsync(101);
    expect(published().map((bid) => bid.message.builderIndex)).toEqual([index]);
    expect(stage.journal?.queryExposure(oldId, Date.now()).commitmentCount).toBe(0);
    expect(stage.journal?.queryExposure(newId, Date.now()).commitmentCount).toBe(1);
    expect(stage.bidStore.getOfferEligibility(published()[0])?.generation).toBe("0x1");
    expect(primary.journal?.queryExposure(oldId, Date.now()).commitmentCount).toBe(1);
    expect(payloadStore.size).toBe(1);
    expect(payloadStore.get(toRootHex(published()[0].message.blockHash))?.payload.orderMetadata?.orderIds).toEqual([
      oldId,
    ]);
    expect(logger.error).not.toHaveBeenCalled();
    controller.abort();
    await building;
  });

  it("uses one construction session, distinct signing identities and increasing values at three deadlines", async () => {
    const second = identity(2, [], {durable: true});
    const third = identity(3, [], {durable: true});
    const primary = identity(1, [second.stage, third.stage], {durable: true});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(10200);
    expect(published().map((bid) => bid.message.builderIndex)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(900);
    expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(900);
    expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 2, 3]);
    expect(published().map((bid) => bid.message.value)).toEqual([900_000_000, 1_800_000_000, 2_700_000_000]);
    const signed = published()[1];
    expect(signed.signature).toEqual(second.signer.signExecutionPayloadBid(signed.message).signature);
    expect(primary.bidStore.get(slot, toRootHex(parentHash), toRootHex(parentRoot))?.message.builderIndex).toBe(1);
    expect(primary.bidStore.has(signed)).toBe(false);
    expect(payloadStore.size).toBe(3);
    await vi.advanceTimersByTimeAsync(1300);
    await building;
    expect(source.prepare).toHaveBeenCalledOnce();
    expect(source.release).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();

    const recoveredPayloads = new PayloadStore();
    const recoveredLedger = new BidLedger();
    const recoveredBids = new BidStore();
    new CommitmentJournal(path.join(directory, "2"), second.journalIdentity, 1).recover(
      1,
      recoveredPayloads,
      recoveredBids,
      recoveredLedger
    );
    expect(recoveredLedger.hasSubmitted(slot, toRootHex(parentHash), toRootHex(parentRoot))).toBe(true);
    expect(recoveredBids.has(signed)).toBe(true);
    expect(recoveredPayloads.has(toRootHex(signed.message.blockHash))).toBe(true);
    expect(primary.ledger.getBidsForSlot(slot)).toHaveLength(3);
    expect(recoveredLedger.getBidsForSlot(slot)).toHaveLength(1);

    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.body.signedExecutionPayloadBid = signed;
    const observed = {
      slot,
      blockRoot: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
      executionOptimistic: false,
      version: ForkName.gloas as const,
      block,
      signedBid: signed,
    };
    await Promise.all([
      primary.revealer.onBlock(observed),
      second.revealer.onBlock(observed),
      third.revealer.onBlock(observed),
    ]);
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][0].signedEnvelopeOrContents).toMatchObject({
      signedExecutionPayloadEnvelope: {message: {builderIndex: 2, payload: {blockHash: signed.message.blockHash}}},
    });
  });

  it.each([{status: "pending" as const}, {balance: 1_100_000_000}])(
    "isolates an ineligible extra identity %j",
    async (options) => {
      const second = identity(2, [], options);
      const third = identity(3);
      const primary = identity(1, [second.stage, third.stage]);
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(13300);
      await building;
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 3]);
      expect(second.ledger.getBidsForSlot(slot)).toHaveLength(0);
    }
  );

  it("does not use an identity for an equal or insufficient value increase", async () => {
    source.getPayload.mockImplementation(async () =>
      payload(Date.now() >= 10800 ? 2 : 1, Date.now() >= 10800 ? 1_000_001_000 : 1_000_000_000)
    );
    const second = identity(2);
    const primary = identity(1, [second.stage]);
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(13300);
    await building;
    expect(published()).toHaveLength(1);
    expect(second.ledger.getBidsForSlot(slot)).toHaveLength(0);
    expect(primary.bidStore.get(slot, toRootHex(parentHash), toRootHex(parentRoot))?.message.value).toBeGreaterThan(
      published()[0].message.value
    );
  });

  it("reports a late 1.3% improvement below the gossip floor while retaining the higher API bid", async () => {
    source.getPayload.mockImplementation(async () =>
      payload(Date.now() >= 10800 ? 2 : 1, Date.now() >= 10800 ? 32_288_889 : 31_862_347)
    );
    const second = identity(2);
    const primary = identity(1, [second.stage]);
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(13300);
    await building;
    const offered = published();
    expect(offered).toHaveLength(1);
    const latest = primary.bidStore.get(slot, toRootHex(parentHash), toRootHex(parentRoot));
    if (!latest) throw Error("Missing higher API bid");
    expect(latest.message.value).toBeGreaterThan(offered[0].message.value);
    expect(latest.message.value).toBeLessThan(getMinGossipBidValue(offered[0].message.value));
    expect(second.ledger.getBidsForSlot(slot)).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      "Skipped staged execution payload bid",
      expect.objectContaining({
        builderIndex: 2,
        reason: "below_gossip_minimum",
        computedValueGwei: latest.message.value,
        minimumValueGwei: getMinGossipBidValue(offered[0].message.value),
      })
    );
  });

  it.each([false, true])("skips a pending gossip without deferring it (enabled: %s)", async (enabled) => {
    const transport = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadBid>>>();
    api.beacon.publishExecutionPayloadBid.mockReturnValueOnce(transport.promise);
    const second = identity(2);
    const third = identity(3);
    const primary = identity(1, [second.stage, third.stage], {deferUnusedGossipStages: enabled});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11200);
    expect(published()).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      "Skipped staged execution payload bid",
      expect.objectContaining({builderIndex: 2, reason: "publication_pending", refreshAttempted: false})
    );
    transport.resolve(mockApiResponse({}));
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 3]);
  });

  it.each([false, true])(
    "makes a first zero-time gossip on a later durable revision only when deferred stages are enabled: %s",
    async (enabled) => {
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12100 ? 2 : 1));
      const second = identity(2, [], {durable: true});
      second.stage.deadlineBps = 10000;
      const third = identity(3);
      third.stage.deadlineBps = 10200;
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const primary = identity(1, [second.stage, third.stage], {
        updateIntervalMs: 25,
        deferUnusedGossipStages: enabled,
      });
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12000);
      expect(sign).not.toHaveBeenCalled();
      expect(second.ledger.getRevisionCount(slot)).toBe(0);
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1]);

      await vi.advanceTimersByTimeAsync(100);
      expect(published().map((bid) => bid.message.builderIndex)).toEqual(enabled ? [1, 2] : [1]);
      expect(sign).toHaveBeenCalledTimes(enabled ? 1 : 0);
      await vi.advanceTimersByTimeAsync(1200);
      await building;
      expect(published().map((bid) => bid.message.builderIndex)).toEqual(enabled ? [1, 2] : [1, 3]);
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  describe("deferred unused stages", () => {
    function setup(
      secondOptions: Parameters<typeof identity>[2] = {},
      primaryOptions: Parameters<typeof identity>[2] = {}
    ) {
      const second = identity(2, [], secondOptions);
      second.stage.deadlineBps = 10000;
      const third = identity(3);
      third.stage.deadlineBps = 10200;
      const primary = identity(1, [second.stage, third.stage], {
        updateIntervalMs: 25,
        deferUnusedGossipStages: true,
        ...primaryOptions,
      });
      return {second, third, primary};
    }

    it("uses exact integer values and wakes once at the floor, not one Gwei below", async () => {
      source.getPayload.mockImplementation(async () =>
        Date.now() >= 12100 ? payload(3, 1_011_111_112) : Date.now() >= 12050 ? payload(2, 1_011_111_111) : payload(1)
      );
      const {second, primary} = setup();
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12075);
      expect(primary.bidStore.get(slot, toRootHex(parentHash), toRootHex(parentRoot))?.message.value).toBe(909_999_999);
      expect(sign).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(25);
      expect(published().at(-1)?.message).toMatchObject({
        builderIndex: 2,
        value: getMinGossipBidValue(900_000_000),
        blockHash: payload(3).executionPayload.blockHash,
      });
      await vi.advanceTimersByTimeAsync(1200);
      await building;
      expect(sign).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])(
      "excludes an existing signed revision only for the same parents: %s",
      async (sameParents) => {
        source.getPayload.mockImplementation(async () => payload(Date.now() >= 12100 ? 2 : 1));
        const {second, primary} = setup();
        const previous = {
          slot,
          parentBlockHash: toRootHex(parentHash),
          parentBlockRoot: toRootHex(sameParents ? parentRoot : Buffer.alloc(32, 33)),
          blockHash: toRootHex(Buffer.alloc(32, 99)),
          signedBidRoot: toRootHex(Buffer.alloc(32, 98)),
          valueGwei: 0,
        };
        second.ledger.recordRevision(previous);
        const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
        const building = primary.bidder.onPayloadAttributes(event());
        await vi.advanceTimersByTimeAsync(13300);
        await building;
        expect(sign).toHaveBeenCalledTimes(sameParents ? 0 : 1);
        expect(published().map((bid) => bid.message.builderIndex)).toEqual(sameParents ? [1, 3] : [1, 2]);
        expect(second.ledger.getBidsForSlot(slot)).toContainEqual({...previous, wonBlockRoots: []});
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it.each([12200, 12225])("requires room for preparation before the fixed next stage: %s", async (readyAt) => {
      source.getPayload.mockImplementation(async () => payload(Date.now() >= readyAt ? 2 : 1));
      const {second, primary} = setup();
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(13300);
      await building;
      expect(sign).toHaveBeenCalledTimes(readyAt === 12200 ? 1 : 0);
      expect(published().map((bid) => bid.message.builderIndex)).toEqual(readyAt === 12200 ? [1, 2] : [1, 3]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      {status: "pending" as BuilderStatus, balance: 10_000_000_000},
      {status: "active" as BuilderStatus, balance: 1_100_000_000},
    ])("does not defer an initially ineligible identity: %j", async (options) => {
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12100 ? 2 : 1));
      const {second, primary} = setup(options);
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12025);
      options.status = "active";
      options.balance = 10_000_000_000;
      await vi.advanceTimersByTimeAsync(1275);
      await building;
      expect(sign).not.toHaveBeenCalled();
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 3]);
      expect(logger.info).not.toHaveBeenCalledWith(
        "Deferred staged execution payload bid",
        expect.objectContaining({builderIndex: 2})
      );
    });

    it.each(["expired", "cancelled", "generation changed", "parent changed"])(
      "disposes an unsigned wait when its context is %s",
      async (reason) => {
        const lease = {generation: "0x1", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity};
        source.getPayload.mockImplementation(async () => ({
          ...payload(Date.now() >= (reason === "expired" ? 12250 : 12100) ? 2 : 1),
          offerEligibility: {generation: "0x1", lease},
        }));
        const {second, primary} = setup();
        const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
        const building = primary.bidder.onPayloadAttributes(event());
        await vi.advanceTimersByTimeAsync(12025);
        expect(logger.info).toHaveBeenCalledWith(
          "Deferred staged execution payload bid",
          expect.objectContaining({builderIndex: 2})
        );
        let replacement: Promise<void> | undefined;
        if (reason === "cancelled") controller.abort();
        if (reason === "generation changed") lease.generation = "0x2";
        if (reason === "parent changed") {
          const next = event();
          next.data.parentBlockRoot = Buffer.alloc(32, 33);
          replacement = primary.bidder.onPayloadAttributes(next);
        }
        await vi.advanceTimersByTimeAsync(1275);
        await Promise.all([building, replacement]);
        expect(sign).not.toHaveBeenCalled();
        expect(second.ledger.getRevisionCount(slot)).toBe(0);
        expect(payloadStore.has(toRootHex(payload(1).executionPayload.blockHash))).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it("does not wake before the higher primary revision is durably retained", async () => {
      const persistence = defer<void>();
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12100 ? 2 : 1));
      const {second, primary} = setup(
        {},
        {
          retain: (bid) =>
            toRootHex(bid.message.blockHash) === toRootHex(payload(2).executionPayload.blockHash)
              ? persistence.promise
              : Promise.resolve(),
        }
      );
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12120);
      expect(sign).not.toHaveBeenCalled();
      persistence.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(sign).toHaveBeenCalledOnce();
      expect(published().at(-1)?.message.builderIndex).toBe(2);
      await vi.advanceTimersByTimeAsync(1180);
      await building;
    });

    it.each(["unresolved", "uncertain"])("does not rearm after A to B to A with an %s admission", async (outcome) => {
      const persistence = defer<void>();
      const retain = vi.fn().mockReturnValueOnce(persistence.promise).mockResolvedValue(undefined);
      let branchB = false;
      source.getPayload.mockImplementation(async () => payload(branchB ? 4 : Date.now() >= 12100 ? 2 : 1));
      const {second, primary} = setup({retain});
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const first = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(10200);
      const pending = second.bidPublisher
        .prepare(
          {...published()[0].message, builderIndex: 2},
          undefined,
          payloadStore.get(toRootHex(published()[0].message.blockHash)) ?? undefined
        )
        .then(
          () => "retained",
          () => "uncertain"
        );
      expect(second.bidPublisher.hasPendingRevisions(slot)).toBe(true);
      branchB = true;
      const next = event();
      next.data.parentBlockRoot = Buffer.alloc(32, 33);
      const other = primary.bidder.onPayloadAttributes(next);
      await vi.advanceTimersByTimeAsync(25);
      await first;
      branchB = false;
      const returned = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(25);
      await other;
      if (outcome === "uncertain") {
        persistence.reject(new CommitmentJournalError("COMMITMENT_WORKER_TIMEOUT", true));
        expect(await pending).toBe("uncertain");
      }
      await vi.advanceTimersByTimeAsync(3050);
      await returned;
      expect(sign).toHaveBeenCalledOnce();
      expect(retain).toHaveBeenCalledOnce();
      expect(second.bidPublisher.hasPendingRevisions(slot)).toBe(true);
      expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(0);
      expect(logger.info).toHaveBeenCalledWith(
        "Skipped staged execution payload bid",
        expect.objectContaining({builderIndex: 2, reason: "pending_revision", deferredMs: 0})
      );
      if (outcome === "unresolved") {
        persistence.resolve();
        expect(await pending).toBe("retained");
      }
      expect(vi.getTimerCount()).toBe(0);
    });

    it("rechecks pending admission when a deferred stage wakes", async () => {
      const persistence = defer<void>();
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12100 ? 2 : 1));
      const {second, primary} = setup({retain: () => persistence.promise});
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12050);
      const pending = second.bidPublisher.prepare(
        {...published()[0].message, builderIndex: 2},
        undefined,
        payloadStore.get(toRootHex(published()[0].message.blockHash)) ?? undefined
      );
      await vi.advanceTimersByTimeAsync(1250);
      await building;
      expect(sign).toHaveBeenCalledOnce();
      expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(0);
      expect(logger.info).toHaveBeenCalledWith(
        "Skipped staged execution payload bid",
        expect.objectContaining({builderIndex: 2, reason: "pending_revision", deferredMs: 100})
      );
      persistence.resolve();
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    });

    it("rechecks collateral and does not retry a higher bid the identity cannot cover", async () => {
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12100 ? 2 : 1));
      const options = {balance: 2_000_000_000};
      const {second, primary} = setup(options);
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12125);
      expect(logger.info).toHaveBeenCalledWith(
        "Deferred staged execution payload bid",
        expect.objectContaining({builderIndex: 2, computedValueGwei: 900_000_000})
      );
      expect(logger.info).toHaveBeenCalledWith(
        "Bid policy declined to bid",
        expect.objectContaining({payloadValueGwei: 2_000_000_000, coverableGwei: 1_000_000_000})
      );
      options.balance = 10_000_000_000;
      await vi.advanceTimersByTimeAsync(1175);
      await building;
      expect(sign).not.toHaveBeenCalled();
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 3]);
      const skipped = vi
        .mocked(logger.info)
        .mock.calls.find(
          ([message, context]) =>
            message === "Skipped staged execution payload bid" &&
            context !== null &&
            typeof context === "object" &&
            "builderIndex" in context &&
            context.builderIndex === 2
        )?.[1];
      expect(skipped).toMatchObject({reason: "no_prepared_bid", phase: "after_preparation"});
      expect(skipped).not.toHaveProperty("computedValueGwei");
      expect(skipped).not.toHaveProperty("minimumValueGwei");
    });

    it.each(["acknowledged", "lost"])("bounds busy retention and never retries its late %s reply", async (reply) => {
      const persistence = defer<void>();
      const retain = vi.fn(async (bid: gloas.SignedExecutionPayloadBid) => {
        const stored = payloadStore.get(toRootHex(bid.message.blockHash));
        if (!stored) throw Error("missing test payload");
        second.journal?.retain(bid, stored);
        await persistence.promise;
      });
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12150 ? 3 : Date.now() >= 12100 ? 2 : 1));
      const {second, primary} = setup({durable: true, retain});
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12125);
      expect(logger.info).toHaveBeenCalledWith(
        "Skipped staged execution payload bid",
        expect.objectContaining({builderIndex: 2, reason: "deferred_prepare_timeout"})
      );
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1]);
      await vi.advanceTimersByTimeAsync(115);
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 3]);
      if (reply === "acknowledged") persistence.resolve();
      else persistence.reject(new CommitmentJournalError("COMMITMENT_WORKER_TIMEOUT", true));
      await vi.advanceTimersByTimeAsync(1060);
      await building;
      expect(sign).toHaveBeenCalledOnce();
      expect(retain).toHaveBeenCalledOnce();
      expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(0);
      const recovered = new BidLedger();
      const retainedPayloads = new PayloadStore();
      new CommitmentJournal(path.join(directory, "2"), second.journalIdentity, 1).recover(
        1,
        retainedPayloads,
        new BidStore(),
        recovered
      );
      expect(recovered.getRevisionCount(slot)).toBe(1);
      expect(retainedPayloads.has(toRootHex(payload(2).executionPayload.blockHash))).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("fences generation changes during the first deferred retention without signing again", async () => {
      const persistence = defer<void>();
      const lease = {generation: "0x1", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity};
      source.getPayload.mockImplementation(async () => ({
        ...payload(Date.now() >= 12100 ? 2 : 1),
        offerEligibility: {generation: "0x1", lease},
      }));
      const {second, primary} = setup({retain: () => persistence.promise});
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12105);
      expect(sign).toHaveBeenCalledOnce();
      lease.generation = "0x2";
      persistence.resolve();
      await vi.advanceTimersByTimeAsync(1195);
      await building;
      expect(sign).toHaveBeenCalledOnce();
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1]);
      expect(second.ledger.getRevisionCount(slot)).toBe(1);
      expect(payloadStore.has(toRootHex(payload(2).executionPayload.blockHash))).toBe(true);
    });

    it("preserves the deferred commitment when cancellation races retention", async () => {
      const persistence = defer<void>();
      const retain = vi.fn(async (bid: gloas.SignedExecutionPayloadBid) => {
        const stored = payloadStore.get(toRootHex(bid.message.blockHash));
        if (!stored) throw Error("missing test payload");
        second.journal?.retain(bid, stored);
        await persistence.promise;
      });
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12100 ? 2 : 1));
      const {second, primary} = setup({durable: true, retain});
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12105);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      await building;
      persistence.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(sign).toHaveBeenCalledOnce();
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1]);
      expect(second.ledger.getRevisionCount(slot)).toBe(1);
      const recovered = new BidLedger();
      const retainedPayloads = new PayloadStore();
      new CommitmentJournal(path.join(directory, "2"), second.journalIdentity, 1).recover(
        1,
        retainedPayloads,
        new BidStore(),
        recovered
      );
      expect(recovered.getRevisionCount(slot)).toBe(1);
      expect(retainedPayloads.has(toRootHex(payload(2).executionPayload.blockHash))).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps the next stage skipped while a deferred transport is still pending", async () => {
      const transport = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadBid>>>();
      api.beacon.publishExecutionPayloadBid
        .mockResolvedValueOnce(mockApiResponse({}))
        .mockReturnValueOnce(transport.promise);
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12150 ? 3 : Date.now() >= 12100 ? 2 : 1));
      const {second, third, primary} = setup();
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const thirdSign = vi.spyOn(third.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(12250);
      expect(logger.info).toHaveBeenCalledWith(
        "Skipped staged execution payload bid",
        expect.objectContaining({builderIndex: 3, reason: "publication_pending"})
      );
      transport.reject(Error("ambiguous deferred send"));
      await vi.advanceTimersByTimeAsync(1050);
      await building;
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 2]);
      expect(sign).toHaveBeenCalledOnce();
      expect(thirdSign).not.toHaveBeenCalled();
      expect(second.ledger.hasSubmitted(slot, toRootHex(parentHash), toRootHex(parentRoot))).toBe(true);
      expect(second.bidStore.has(published()[1])).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not repeat an uncertain deferred send after more eligible revisions arrive", async () => {
      api.beacon.publishExecutionPayloadBid
        .mockResolvedValueOnce(mockApiResponse({}))
        .mockRejectedValueOnce(Error("ambiguous send"));
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12150 ? 3 : Date.now() >= 12100 ? 2 : 1));
      const {second, primary} = setup();
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(13300);
      await building;
      expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(1);
      expect(second.ledger.hasSubmitted(slot, toRootHex(parentHash), toRootHex(parentRoot))).toBe(true);
      expect(second.bidStore.has(published()[1])).toBe(true);
      expect(payloadStore.has(toRootHex(published()[1].message.blockHash))).toBe(true);
    });

    it("keeps the existing single refresh when a deferred first retention sees a richer revision", async () => {
      let retained = 0;
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 12125 ? 3 : Date.now() >= 12100 ? 2 : 1));
      const {second, primary} = setup(
        {
          retain: async () => {
            if (++retained === 1) await new Promise((resolve) => setTimeout(resolve, 20));
          },
        },
        {
          retain: async (bid) => {
            if (toRootHex(bid.message.blockHash) === toRootHex(payload(2).executionPayload.blockHash))
              await new Promise((resolve) => setTimeout(resolve, 10));
          },
        }
      );
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(13300);
      await building;
      const staged = published().filter((bid) => bid.message.builderIndex === 2);
      expect(staged).toHaveLength(1);
      expect(staged[0].message.blockHash).toEqual(payload(3).executionPayload.blockHash);
      expect(sign).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        "Gossiped execution payload bid",
        expect.objectContaining({builderIndex: 2, deferredMs: 110, initialPrepareMs: 20, refreshAttempted: true})
      );
    });
  });

  it("never retries an uncertain stage send, and retains its bid", async () => {
    api.beacon.publishExecutionPayloadBid
      .mockResolvedValueOnce(mockApiResponse({}))
      .mockRejectedValueOnce(Error("ambiguous send"));
    const second = identity(2);
    const primary = identity(1, [second.stage]);
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11200);
    await primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(published()).toHaveLength(2);
    expect(second.ledger.hasSubmitted(slot, toRootHex(parentHash), toRootHex(parentRoot))).toBe(true);
    expect(payloadStore.has(toRootHex(published()[1].message.blockHash))).toBe(true);
  });

  it.each([false, true])(
    "refreshes once during retention and keeps both commitments (uncertain gossip: %s)",
    async (uncertain) => {
      const persistence = defer<void>();
      let retained = 0;
      if (uncertain)
        api.beacon.publishExecutionPayloadBid
          .mockResolvedValueOnce(mockApiResponse({}))
          .mockRejectedValueOnce(Error("ambiguous send"));
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1));
      const second = identity(2, [], {
        durable: true,
        retain: async (bid) => {
          const stored = payloadStore.get(toRootHex(bid.message.blockHash));
          if (!stored) throw Error("missing test payload");
          second.journal?.retain(bid, stored);
          if (++retained === 1) await persistence.promise;
        },
      });
      const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
      second.stage.deadlineBps = 9251;
      const primary = identity(1, [second.stage], {updateIntervalMs: 25});
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(11125);
      expect(sign).toHaveBeenCalledOnce();
      expect(primary.bidStore.get(slot, toRootHex(parentHash), toRootHex(parentRoot))?.message.blockHash).toEqual(
        payload(3).executionPayload.blockHash
      );
      persistence.resolve();
      await vi.advanceTimersByTimeAsync(2100);
      await building;

      const staged = published().filter((bid) => bid.message.builderIndex === 2);
      expect(staged).toHaveLength(1);
      expect(staged[0].message.blockHash).toEqual(payload(3).executionPayload.blockHash);
      expect(sign).toHaveBeenCalledTimes(2);
      expect(second.ledger.getBidsForSlot(slot)).toHaveLength(2);
      expect(second.ledger.hasSubmitted(slot, toRootHex(parentHash), toRootHex(parentRoot))).toBe(true);

      const recoveredPayloads = new PayloadStore();
      const recoveredLedger = new BidLedger();
      const recoveredBids = new BidStore();
      new CommitmentJournal(path.join(directory, "2"), second.journalIdentity, 1).recover(
        1,
        recoveredPayloads,
        recoveredBids,
        recoveredLedger
      );
      expect(recoveredLedger.getBidsForSlot(slot)).toHaveLength(2);
      for (const revision of [2, 3]) {
        expect(
          recoveredPayloads.has(toRootHex(payload(revision).executionPayload.blockHash)),
          `revision ${revision} must remain revealable`
        ).toBe(true);
      }
    }
  );

  it("retains but does not gossip a stage whose persistence finishes after cancellation", async () => {
    const persistence = defer<void>();
    const second = identity(2, [], {retain: () => persistence.promise});
    const primary = identity(1, [second.stage]);
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11100);
    controller.abort();
    persistence.resolve();
    await building;
    expect(published()).toHaveLength(1);
    expect(second.ledger.getBidsForSlot(slot)).toHaveLength(1);
    expect(second.ledger.hasSubmitted(slot, toRootHex(parentHash), toRootHex(parentRoot))).toBe(false);
    expect(payloadStore.has(second.ledger.getBidsForSlot(slot)[0].blockHash)).toBe(true);
  });

  it("keeps the original after a preparation above 25 ms even with ample stage headroom", async () => {
    const persistence = defer<void>();
    source.getPayload.mockImplementation(async () => payload(Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1));
    const second = identity(2, [], {retain: () => persistence.promise});
    const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
    const primary = identity(1, [second.stage], {updateIntervalMs: 25});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11126);
    expect(primary.bidStore.get(slot, toRootHex(parentHash), toRootHex(parentRoot))?.message.blockHash).toEqual(
      payload(3).executionPayload.blockHash
    );
    persistence.resolve();
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(sign).toHaveBeenCalledOnce();
    expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(1);
    expect(published().at(-1)?.message.blockHash).toEqual(payload(2).executionPayload.blockHash);
    expect(logger.info).toHaveBeenCalledWith(
      "Gossiped execution payload bid",
      expect.objectContaining({builderIndex: 2, initialPrepareMs: 26, refreshAttempted: false})
    );
  });

  it("does not chase another revision during the single refresh", async () => {
    const persistence = [defer<void>(), defer<void>()];
    let retained = 0;
    source.getPayload.mockImplementation(async () =>
      payload(Date.now() >= 11150 ? 4 : Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1)
    );
    const second = identity(2, [], {retain: () => persistence[retained++]?.promise ?? Promise.resolve()});
    second.stage.deadlineBps = 9251;
    const primary = identity(1, [second.stage], {updateIntervalMs: 25});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11126);
    persistence[0].resolve();
    await vi.advanceTimersByTimeAsync(24);
    expect(retained).toBe(2);
    expect(primary.bidStore.get(slot, toRootHex(parentHash), toRootHex(parentRoot))?.message.blockHash).toEqual(
      payload(4).executionPayload.blockHash
    );
    persistence[1].resolve();
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(retained).toBe(2);
    expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(1);
    expect(published().at(-1)?.message.blockHash).toEqual(payload(3).executionPayload.blockHash);
  });

  it("uses the retained bid when another preparation would exhaust the stage window", async () => {
    const persistence = defer<void>();
    source.getPayload.mockImplementation(async () => payload(Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1));
    const second = identity(2, [], {retain: () => persistence.promise});
    const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
    const third = identity(3);
    third.stage.deadlineBps = 9290;
    second.stage.deadlineBps = 9251;
    const primary = identity(1, [second.stage, third.stage], {updateIntervalMs: 25});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11125);
    persistence.resolve();
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(sign).toHaveBeenCalledOnce();
    expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 2, 3]);
    expect(published()[1].message.blockHash).toEqual(payload(2).executionPayload.blockHash);
    expect(published()[2].message.blockHash).toEqual(payload(3).executionPayload.blockHash);
  });

  it("falls back to the durable bid after an uncertain refresh without retrying or freeing its admission", async () => {
    const persistence = defer<void>();
    let retained = 0;
    source.getPayload.mockImplementation(async () => payload(Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1));
    const second = identity(2, [], {
      durable: true,
      retain: async (bid) => {
        const stored = payloadStore.get(toRootHex(bid.message.blockHash));
        if (!stored) throw Error("missing test payload");
        second.journal?.retain(bid, stored);
        if (++retained === 1) await persistence.promise;
        else throw new CommitmentJournalError("COMMITMENT_WORKER_TIMEOUT", true);
      },
    });
    second.stage.deadlineBps = 9251;
    const primary = identity(1, [second.stage], {updateIntervalMs: 25});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11125);
    persistence.resolve();
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    const staged = published().filter((bid) => bid.message.builderIndex === 2);
    expect(staged).toHaveLength(1);
    expect(staged[0].message.blockHash).toEqual(payload(2).executionPayload.blockHash);
    expect(retained).toBe(2);
    expect(second.ledger.getBidsForSlot(slot)).toHaveLength(1);
    await expect(
      second.bidPublisher.prepare(
        staged[0].message,
        2,
        payloadStore.get(toRootHex(staged[0].message.blockHash)) ?? undefined
      )
    ).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.REVISION_LIMIT},
    });
    const recoveredPayloads = new PayloadStore();
    const recoveredLedger = new BidLedger();
    new CommitmentJournal(path.join(directory, "2"), second.journalIdentity, 1).recover(
      1,
      recoveredPayloads,
      new BidStore(),
      recoveredLedger
    );
    expect(recoveredLedger.getBidsForSlot(slot)).toHaveLength(2);
    for (const revision of [2, 3]) {
      expect(
        recoveredPayloads.has(toRootHex(payload(revision).executionPayload.blockHash)),
        `revision ${revision} must remain revealable`
      ).toBe(true);
    }
  });

  it.each([
    {reply: "acknowledged", deadlineBps: 9251, nextDeadlineBps: 9300, budget: 25},
    {reply: "lost", deadlineBps: 9251, nextDeadlineBps: 9300, budget: 25},
    {reply: "acknowledged", deadlineBps: 9270, nextDeadlineBps: 9290, budget: 13},
  ])(
    "gossips the original within the refresh budget and keeps a late signature: %j",
    async ({reply, deadlineBps, nextDeadlineBps, budget}) => {
      const persistence = [defer<void>(), defer<void>()];
      let retained = 0;
      source.getPayload.mockImplementation(async () => payload(Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1));
      const second = identity(2, [], {
        durable: true,
        retain: async (bid) => {
          const stored = payloadStore.get(toRootHex(bid.message.blockHash));
          if (!stored) throw Error("missing test payload");
          second.journal?.retain(bid, stored);
          await persistence[retained++].promise;
        },
      });
      const third = identity(3);
      third.stage.deadlineBps = nextDeadlineBps;
      second.stage.deadlineBps = deadlineBps;
      const primary = identity(1, [second.stage, third.stage], {updateIntervalMs: 25});
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(11125);
      persistence[0].resolve();
      await vi.advanceTimersByTimeAsync(budget - 1);
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1]);
      await vi.advanceTimersByTimeAsync(1);
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 2]);
      expect(published()[1].message.blockHash).toEqual(payload(2).executionPayload.blockHash);
      expect(logger.info).toHaveBeenCalledWith(
        "Gossiped execution payload bid",
        expect.objectContaining({builderIndex: 2, refreshAttempted: true, refreshTimedOut: true, refreshMs: budget})
      );
      await vi.advanceTimersByTimeAsync(25);
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 2, 3]);
      expect(published()[2].message.blockHash).toEqual(payload(3).executionPayload.blockHash);
      if (reply === "acknowledged") persistence[1].resolve();
      else persistence[1].reject(new CommitmentJournalError("COMMITMENT_WORKER_TIMEOUT", true));
      await vi.advanceTimersByTimeAsync(2200);
      await building;
      expect(retained).toBe(2);
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1, 2, 3]);
      expect(second.ledger.getRevisionCount(slot)).toBe(reply === "acknowledged" ? 2 : 1);
      const recoveredPayloads = new PayloadStore();
      const recoveredLedger = new BidLedger();
      new CommitmentJournal(path.join(directory, "2"), second.journalIdentity, 1).recover(
        1,
        recoveredPayloads,
        new BidStore(),
        recoveredLedger
      );
      expect(recoveredLedger.getRevisionCount(slot)).toBe(2);
      for (const revision of [2, 3]) {
        expect(
          recoveredPayloads.has(toRootHex(payload(revision).executionPayload.blockHash)),
          `revision ${revision} must remain revealable`
        ).toBe(true);
      }
    }
  );

  it.each(["cancelled", "expired", "generation changed"])(
    "retains both commitments without gossip when the refresh becomes %s",
    async (reason) => {
      const persistence = [defer<void>(), defer<void>()];
      const lease = {generation: "1", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity};
      let retained = 0;
      source.getPayload.mockImplementation(async () => ({
        ...payload(Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1),
        offerEligibility: {generation: lease.generation, lease},
      }));
      const second = identity(2, [], {retain: () => persistence[retained++]?.promise ?? Promise.resolve()});
      second.stage.deadlineBps = 9251;
      const primary = identity(1, [second.stage], {updateIntervalMs: 25});
      const building = primary.bidder.onPayloadAttributes(event());
      await vi.advanceTimersByTimeAsync(11125);
      persistence[0].resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(retained).toBe(2);
      if (reason === "cancelled") controller.abort();
      else if (reason === "generation changed") lease.generation = "2";
      else vi.setSystemTime(13200);
      persistence[1].resolve();
      await vi.advanceTimersByTimeAsync(2100);
      await building;
      expect(published().map((bid) => bid.message.builderIndex)).toEqual([1]);
      expect(second.ledger.getBidsForSlot(slot)).toHaveLength(2);
      expect(second.ledger.hasSubmitted(slot, toRootHex(parentHash), toRootHex(parentRoot))).toBe(false);
      if (reason === "expired")
        expect(logger.info).toHaveBeenCalledWith(
          "Skipped staged execution payload bid",
          expect.objectContaining({builderIndex: 2, reason: "stage_expired", refreshAttempted: true})
        );
      for (const revision of [2, 3]) {
        expect(
          payloadStore.has(toRootHex(payload(revision).executionPayload.blockHash)),
          `revision ${revision} must remain revealable`
        ).toBe(true);
      }
    }
  );

  it("gossips the original when the stage cannot cover the higher refreshed value", async () => {
    const persistence = defer<void>();
    source.getPayload.mockImplementation(async () => payload(Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1));
    const second = identity(2, [], {balance: 3_000_000_000, retain: () => persistence.promise});
    const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
    second.stage.deadlineBps = 9251;
    const primary = identity(1, [second.stage], {updateIntervalMs: 25});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11125);
    persistence.resolve();
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(sign).toHaveBeenCalledOnce();
    expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(1);
    expect(published().at(-1)?.message.blockHash).toEqual(payload(2).executionPayload.blockHash);
  });

  it("keeps the original gossip when refresh hits the identity's retained revision limit", async () => {
    const persistence = defer<void>();
    source.getPayload.mockImplementation(async () => payload(Date.now() >= 11125 ? 3 : Date.now() >= 10800 ? 2 : 1));
    const second = identity(2, [], {retain: () => persistence.promise});
    for (let index = 0; index < 255; index++) {
      second.ledger.recordRevision({
        slot,
        parentBlockHash: toRootHex(parentHash),
        parentBlockRoot: toRootHex(parentRoot),
        blockHash: toRootHex(Buffer.alloc(32, index)),
        signedBidRoot: toRootHex(Buffer.alloc(32, index)),
        valueGwei: 0,
      });
    }
    const sign = vi.spyOn(second.signer, "signExecutionPayloadBid");
    second.stage.deadlineBps = 9251;
    const primary = identity(1, [second.stage], {updateIntervalMs: 25});
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11125);
    persistence.resolve();
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(sign).toHaveBeenCalledOnce();
    expect(second.ledger.getRevisionCount(slot)).toBe(256);
    expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(1);
    expect(published().at(-1)?.message.blockHash).toEqual(payload(2).executionPayload.blockHash);
  });

  it("skips expired stages when a parent build starts late", async () => {
    vi.setSystemTime(11200);
    const second = identity(2);
    const third = identity(3);
    const primary = identity(1, [second.stage, third.stage]);
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(published().map((bid) => bid.message.builderIndex)).toEqual([3]);
  });

  it("consumes recovered stage allowances before any new timer can send", async () => {
    const second = identity(2, [], {durable: true});
    const primary = identity(1, [second.stage]);
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11200);
    controller.abort();
    await building;
    expect(published()).toHaveLength(2);
    controller = new AbortController();
    vi.setSystemTime(0);
    const restored = identity(2, [], {durable: true});
    new CommitmentJournal(path.join(directory, "2"), restored.journalIdentity, 0).recover(
      0,
      payloadStore,
      restored.bidStore,
      restored.ledger
    );
    const resumed = identity(1, [restored.stage]);
    api.beacon.publishExecutionPayloadBid.mockClear();
    const again = resumed.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(13300);
    await again;
    expect(published().filter((bid) => bid.message.builderIndex === 2)).toHaveLength(0);
  });

  it("cancels unpublished stages on an actual parent switch while retaining older commitments", async () => {
    const second = identity(2, [], {durable: true});
    const third = identity(3, [], {durable: true});
    const primary = identity(1, [second.stage, third.stage], {durable: true});
    const first = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(11200);
    const previousBid = published()[1];
    const replacement = event();
    replacement.data.parentBlockRoot = Buffer.alloc(32, 22);
    const nextPayload = payload(3);
    nextPayload.executionPayload.blockHash = Buffer.alloc(32, 33);
    source.getPayload.mockResolvedValue(nextPayload);
    const next = primary.bidder.onPayloadAttributes(replacement);
    await vi.advanceTimersByTimeAsync(2100);
    await Promise.all([first, next]);
    expect(published().filter((bid) => bid.message.builderIndex === 3)).toHaveLength(1);
    expect(published().at(-1)?.message.parentBlockRoot).toEqual(replacement.data.parentBlockRoot);
    expect(payloadStore.has(toRootHex(previousBid.message.blockHash))).toBe(true);
    expect(second.ledger.getBidsForSlot(slot)).toHaveLength(1);
    expect(source.prepare).toHaveBeenCalledTimes(2);
  });

  it("does not let a late primary bid overtake a later stage", async () => {
    vi.setSystemTime(10500);
    const first = defer<ReturnType<typeof payload>>();
    source.getPayload.mockReturnValueOnce(first.promise);
    const second = identity(2);
    const third = identity(3);
    const primary = identity(1, [second.stage, third.stage]);
    const building = primary.bidder.onPayloadAttributes(event());
    await vi.advanceTimersByTimeAsync(700);
    first.resolve(payload(2));
    await vi.advanceTimersByTimeAsync(2100);
    await building;
    expect(published().map((bid) => bid.message.builderIndex)).toEqual([3]);
  });
});

describe("gossip stage configuration", () => {
  it.each([
    [0, 100_000],
    [1_000_000, 1_100_000],
    [60_000_000, 61_800_000],
    [60_009_999, 61_809_999],
    [1_000_000_000, 1_010_000_000],
  ])("requires the forwarding increment above %i", (value, expected) => {
    expect(getMinGossipBidValue(value)).toBe(expected);
  });
  it.each([
    [{builderIndex: 1, deadlineBps: 9500}],
    [{builderIndex: 2, deadlineBps: 8500}],
    [{builderIndex: 2, deadlineBps: 11000}],
    [
      {builderIndex: 2, deadlineBps: 9500},
      {builderIndex: 3, deadlineBps: 9400},
    ],
    [{builderIndex: 2, deadlineBps: NaN}],
    Array.from({length: 5}, (_, i) => ({builderIndex: i + 2, deadlineBps: 9000 + i})),
  ])("rejects duplicate, unordered, out-of-window or excessive stages %j", (...stages) => {
    expect(() => validateGossipStages({builderIndex: 1, deadlineBps: 8500}, stages, 1000)).toThrow();
  });
});

describe("staged gossip journal inventory", () => {
  it("canonicalizes equivalent primary paths and rejects removal of a live signer", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-journal-inventory-"));
    try {
      const primary = path.join(root, "primary");
      const gossip = gossipJournalDirectory(primary);
      expect(gossipJournalDirectory(`${primary}/`)).toBe(gossip);
      expect(gossipJournalDirectory(`${primary}/../primary`)).toBe(gossip);
      const pubkey = `0x${"01".repeat(48)}`;
      fs.mkdirSync(path.join(gossip, pubkey), {recursive: true});
      fs.writeFileSync(path.join(gossip, pubkey, `bid-10-0x${"02".repeat(32)}.json`), "{}");
      expect(() => assertGossipJournalsConfigured(primary, new Set(), 12)).toThrow("GOSSIP_JOURNAL_SIGNER_MISSING");
      expect(() => assertGossipJournalsConfigured(primary, new Set([pubkey]), 12)).not.toThrow();
      expect(() => assertGossipJournalsConfigured(primary, new Set(), 13)).not.toThrow();
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
