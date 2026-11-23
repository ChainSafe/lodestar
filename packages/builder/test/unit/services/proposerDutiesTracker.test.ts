import {beforeEach, describe, expect, it, vi} from "vitest";
import {ApiClient} from "@lodestar/api";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {Epoch, RootHex, Slot} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {HeadEvent} from "../../../src/services/headTracker.js";
import {ProposerDutiesTracker} from "../../../src/services/proposerDutiesTracker.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {ClockMock} from "../utils/clock.js";
import {MockedLogger, getMockedLogger} from "../utils/logger.js";

type DutiesResponse = Awaited<ReturnType<ApiClient["validator"]["getProposerDutiesV2"]>>;

function root(value: number): RootHex {
  return toRootHex(Buffer.alloc(32, value));
}

function head(slot: Slot, currentEpochDependentRoot: RootHex, nextEpochDependentRoot: RootHex) {
  return {
    slot,
    block: root(100),
    state: root(101),
    payloadStatus: "full",
    epochTransition: slot % SLOTS_PER_EPOCH === 0,
    currentEpochDependentRoot,
    nextEpochDependentRoot,
    executionOptimistic: false,
  } satisfies HeadEvent["data"];
}

describe("ProposerDutiesTracker", () => {
  let api: ReturnType<typeof getApiClientStub>;
  let clock: ClockMock;
  let logger: MockedLogger;
  let tracker: ProposerDutiesTracker;
  /** Dependent root and validator index offset of the duties the beacon node returns for an epoch */
  let duties: Map<Epoch, {dependentRoot: RootHex; indexOffset: number}>;

  beforeEach(() => {
    duties = new Map([
      [0, {dependentRoot: root(1), indexOffset: 0}],
      [1, {dependentRoot: root(2), indexOffset: 0}],
    ]);
    api = getApiClientStub();
    api.validator.getProposerDutiesV2.mockImplementation(async ({epoch}) => dutiesResponse(epoch));
    clock = new ClockMock();
    logger = getMockedLogger();
    tracker = new ProposerDutiesTracker(api, clock, logger);
  });

  /** Response of the beacon node with the duties currently set for the epoch */
  function dutiesResponse(epoch: Epoch): DutiesResponse {
    const {dependentRoot, indexOffset} = duties.get(epoch) ?? {dependentRoot: root(0), indexOffset: 0};
    return mockApiResponse({
      data: Array.from({length: SLOTS_PER_EPOCH}, (_, i) => ({
        slot: epoch * SLOTS_PER_EPOCH + i,
        validatorIndex: epoch * SLOTS_PER_EPOCH + i + indexOffset,
        pubkey: Buffer.alloc(48, i),
      })),
      meta: {executionOptimistic: false, dependentRoot},
    });
  }

  it("returns the proposer of a slot in the current and next epoch", async () => {
    expect((await tracker.getProposer(3))?.validatorIndex).toBe(3);
    expect((await tracker.getProposer(SLOTS_PER_EPOCH + 1))?.validatorIndex).toBe(SLOTS_PER_EPOCH + 1);
  });

  it("returns null for slots outside of the previous, current and next epoch", async () => {
    clock.currentSlot = 2 * SLOTS_PER_EPOCH;

    expect(await tracker.getProposer(SLOTS_PER_EPOCH - 1)).toBeNull();
    expect(await tracker.getProposer(4 * SLOTS_PER_EPOCH)).toBeNull();
    expect(api.validator.getProposerDutiesV2).not.toHaveBeenCalled();
  });

  it("resolves a slot of the previous epoch from the duties cached while it was the current epoch", async () => {
    const lastSlot = SLOTS_PER_EPOCH - 1;
    expect((await tracker.getProposer(lastSlot))?.validatorIndex).toBe(lastSlot);

    clock.currentSlot = SLOTS_PER_EPOCH;
    await tracker.getProposer(SLOTS_PER_EPOCH);

    expect((await tracker.getProposer(lastSlot))?.validatorIndex).toBe(lastSlot);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("does not fetch the duties of the previous epoch", async () => {
    clock.currentSlot = SLOTS_PER_EPOCH;

    expect(await tracker.getProposer(SLOTS_PER_EPOCH - 1)).toBeNull();
    expect(api.validator.getProposerDutiesV2).not.toHaveBeenCalled();
  });

  it("drops the duties of epochs before the previous one", async () => {
    await tracker.getProposer(1);
    clock.currentSlot = 2 * SLOTS_PER_EPOCH;
    await tracker.getProposer(2 * SLOTS_PER_EPOCH);

    // Epoch 0 is the previous epoch again, it would be resolved if its duties were still cached
    clock.currentSlot = SLOTS_PER_EPOCH;
    expect(await tracker.getProposer(1)).toBeNull();
  });

  it("fetches the duties of an epoch once for concurrent requests", async () => {
    const proposers = await Promise.all([tracker.getProposer(1), tracker.getProposer(2), tracker.getProposer(3)]);

    expect(proposers.map((proposer) => proposer?.validatorIndex)).toEqual([1, 2, 3]);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledExactlyOnceWith({epoch: 0});
  });

  it("fetches the duties again after a failed fetch", async () => {
    api.validator.getProposerDutiesV2.mockRejectedValueOnce(new Error("beacon node unavailable"));

    await expect(tracker.getProposer(1)).rejects.toThrow("beacon node unavailable");
    expect((await tracker.getProposer(1))?.validatorIndex).toBe(1);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("prefetches the duties of an epoch and the one after it", async () => {
    await tracker.prefetch(0);

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledWith({epoch: 0});
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledWith({epoch: 1});

    expect((await tracker.getProposer(3))?.validatorIndex).toBe(3);
    expect((await tracker.getProposer(SLOTS_PER_EPOCH))?.validatorIndex).toBe(SLOTS_PER_EPOCH);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("only prefetches the duties that are not cached", async () => {
    await tracker.prefetch(0);
    clock.currentSlot = SLOTS_PER_EPOCH;

    await tracker.prefetch(1);

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(3);
    expect(api.validator.getProposerDutiesV2).toHaveBeenLastCalledWith({epoch: 2});
  });

  it("does not fail if the duties cannot be prefetched", async () => {
    api.validator.getProposerDutiesV2.mockRejectedValue(new Error("beacon node unavailable"));

    await tracker.prefetch(0);

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("fetches the duties of an epoch once", async () => {
    await tracker.getProposer(1);
    await tracker.getProposer(2);

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledExactlyOnceWith({epoch: 0});
  });

  it("keeps the cached duties while the head reports their dependent roots", async () => {
    await tracker.getProposer(1);
    await tracker.getProposer(SLOTS_PER_EPOCH);

    tracker.onHead(head(2, root(1), root(2)));

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("does not fetch duties that are not cached when a head is announced", () => {
    tracker.onHead(head(2, root(8), root(9)));

    expect(api.validator.getProposerDutiesV2).not.toHaveBeenCalled();
  });

  it("fetches the duties of the head epoch again if their dependent root changed", async () => {
    expect((await tracker.getProposer(3))?.validatorIndex).toBe(3);
    await tracker.getProposer(SLOTS_PER_EPOCH);

    duties.set(0, {dependentRoot: root(8), indexOffset: 1000});
    tracker.onHead(head(2, root(8), root(2)));

    await vi.waitFor(async () => expect((await tracker.getProposer(3))?.validatorIndex).toBe(1003));
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(3);
    expect(api.validator.getProposerDutiesV2).toHaveBeenLastCalledWith({epoch: 0});
  });

  it("fetches the duties of the epoch after the head again if their dependent root changed", async () => {
    await tracker.getProposer(3);
    expect((await tracker.getProposer(SLOTS_PER_EPOCH))?.validatorIndex).toBe(SLOTS_PER_EPOCH);

    duties.set(1, {dependentRoot: root(9), indexOffset: 1000});
    tracker.onHead(head(2, root(1), root(9)));

    await vi.waitFor(async () =>
      expect((await tracker.getProposer(SLOTS_PER_EPOCH))?.validatorIndex).toBe(SLOTS_PER_EPOCH + 1000)
    );
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(3);
    expect(api.validator.getProposerDutiesV2).toHaveBeenLastCalledWith({epoch: 1});
  });

  it("does not fetch the duties of the previous epoch again", async () => {
    await tracker.getProposer(3);
    clock.currentSlot = SLOTS_PER_EPOCH;

    tracker.onHead(head(SLOTS_PER_EPOCH - 1, root(8), root(2)));

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledExactlyOnceWith({epoch: 0});
  });

  it("waits for duties that are being fetched again before resolving a proposer", async () => {
    await tracker.getProposer(3);
    const refetch = defer<DutiesResponse>();
    api.validator.getProposerDutiesV2.mockReturnValueOnce(refetch.promise);
    duties.set(0, {dependentRoot: root(8), indexOffset: 1000});
    tracker.onHead(head(2, root(8), root(2)));

    const proposer = tracker.getProposer(3);
    refetch.resolve(dutiesResponse(0));

    expect((await proposer)?.validatorIndex).toBe(1003);
  });

  it("resolves a proposer from the cached duties if fetching them again fails", async () => {
    await tracker.getProposer(3);
    const refetch = defer<DutiesResponse>();
    api.validator.getProposerDutiesV2.mockReturnValueOnce(refetch.promise);
    tracker.onHead(head(2, root(8), root(2)));

    const proposer = tracker.getProposer(3);
    refetch.reject(new Error("beacon node unavailable"));

    expect((await proposer)?.validatorIndex).toBe(3);
  });

  it("fetches duties again if the head changed their dependent root while they were fetched", async () => {
    const fetch = defer<DutiesResponse>();
    api.validator.getProposerDutiesV2.mockReturnValueOnce(fetch.promise);
    const proposer = tracker.getProposer(3);
    // The response in flight is for the dependent root the head replaces
    const staleResponse = dutiesResponse(0);
    duties.set(0, {dependentRoot: root(8), indexOffset: 1000});
    tracker.onHead(head(2, root(8), root(2)));

    fetch.resolve(staleResponse);

    expect((await proposer)?.validatorIndex).toBe(3);
    await vi.waitFor(async () => expect((await tracker.getProposer(3))?.validatorIndex).toBe(1003));
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("does not fetch duties again if the head reports the dependent root they are fetched for", async () => {
    const fetch = defer<DutiesResponse>();
    api.validator.getProposerDutiesV2.mockReturnValueOnce(fetch.promise);
    const proposer = tracker.getProposer(3);
    tracker.onHead(head(2, root(1), root(2)));

    fetch.resolve(dutiesResponse(0));

    expect((await proposer)?.validatorIndex).toBe(3);
    await tracker.getProposer(4);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledExactlyOnceWith({epoch: 0});
  });

  it("keeps the cached duties if fetching them again fails", async () => {
    await tracker.getProposer(3);
    api.validator.getProposerDutiesV2.mockRejectedValueOnce(new Error("beacon node unavailable"));

    tracker.onHead(head(2, root(8), root(2)));

    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledOnce());
    expect((await tracker.getProposer(3))?.validatorIndex).toBe(3);
  });
});
