import {beforeEach, describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ProposerDutiesTracker} from "../../../src/services/proposerDutiesTracker.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {ClockMock} from "../utils/clock.js";

describe("ProposerDutiesTracker", () => {
  let api: ReturnType<typeof getApiClientStub>;
  let clock: ClockMock;
  let tracker: ProposerDutiesTracker;

  beforeEach(() => {
    api = getApiClientStub();
    api.validator.getProposerDutiesV2.mockImplementation(async ({epoch}) =>
      mockApiResponse({
        data: Array.from({length: SLOTS_PER_EPOCH}, (_, i) => ({
          slot: epoch * SLOTS_PER_EPOCH + i,
          validatorIndex: epoch * SLOTS_PER_EPOCH + i,
          pubkey: Buffer.alloc(48, i),
        })),
        meta: {executionOptimistic: false, dependentRoot: "0x00"},
      })
    );
    clock = new ClockMock();
    tracker = new ProposerDutiesTracker(api, clock);
  });

  it("returns the proposer of a slot in the current and next epoch", async () => {
    expect((await tracker.getProposer(3))?.validatorIndex).toBe(3);
    expect((await tracker.getProposer(SLOTS_PER_EPOCH + 1))?.validatorIndex).toBe(SLOTS_PER_EPOCH + 1);
  });

  it("returns null for slots outside of the current and next epoch", async () => {
    clock.currentSlot = SLOTS_PER_EPOCH;

    expect(await tracker.getProposer(SLOTS_PER_EPOCH - 1)).toBeNull();
    expect(await tracker.getProposer(3 * SLOTS_PER_EPOCH)).toBeNull();
    expect(api.validator.getProposerDutiesV2).not.toHaveBeenCalled();
  });

  it("fetches the duties of an epoch once", async () => {
    await tracker.getProposer(1);
    await tracker.getProposer(2);

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledExactlyOnceWith({epoch: 0});
  });

  it("fetches duties again that were fetched one epoch ahead", async () => {
    await tracker.getProposer(SLOTS_PER_EPOCH);
    clock.currentSlot = SLOTS_PER_EPOCH;
    await tracker.getProposer(SLOTS_PER_EPOCH);
    await tracker.getProposer(SLOTS_PER_EPOCH + 1);

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
    expect(api.validator.getProposerDutiesV2).toHaveBeenLastCalledWith({epoch: 1});
  });
  it("shares concurrent misses and releases a failed lookup for retry", async () => {
    let fail: ((error: Error) => void) | undefined;
    api.validator.getProposerDutiesV2.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const first = tracker.getProposer(1);
    const second = tracker.getProposer(2);
    const rejected = Promise.all([
      expect(first).rejects.toThrow("unavailable"),
      expect(second).rejects.toThrow("unavailable"),
    ]);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(1);
    fail?.(Error("unavailable"));
    await rejected;
    expect((await tracker.getProposer(1))?.validatorIndex).toBe(1);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("does not let an earlier epoch's slow lookup replace the refreshed duties", async () => {
    type Response = Awaited<ReturnType<typeof api.validator.getProposerDutiesV2>>;
    let finishOld: ((response: Response) => void) | undefined;
    api.validator.getProposerDutiesV2.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    const old = tracker.getProposer(SLOTS_PER_EPOCH);
    clock.currentSlot = SLOTS_PER_EPOCH;
    const fresh = await tracker.getProposer(SLOTS_PER_EPOCH);
    finishOld?.(
      mockApiResponse({
        data: [{slot: SLOTS_PER_EPOCH, validatorIndex: 999, pubkey: Buffer.alloc(48)}],
        meta: {executionOptimistic: false, dependentRoot: "0x00"},
      })
    );
    expect((await old)?.validatorIndex).toBe(fresh?.validatorIndex);
    expect((await tracker.getProposer(SLOTS_PER_EPOCH))?.validatorIndex).toBe(fresh?.validatorIndex);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("replaces same-epoch duties from a new primary dependent root without another lookup", async () => {
    expect((await tracker.getProposer(1))?.validatorIndex).toBe(1);
    tracker.update(0, "0x11", [{slot: 1, validatorIndex: 123, pubkey: Buffer.alloc(48, 123)}]);

    expect((await tracker.getProposer(1))?.validatorIndex).toBe(123);
    expect(await tracker.getProposer(2)).toBeNull();
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(1);
  });

  it("returns the authoritative update to all callers awaiting an older same-epoch lookup", async () => {
    type Response = Awaited<ReturnType<typeof api.validator.getProposerDutiesV2>>;
    let finishOld: ((response: Response) => void) | undefined;
    api.validator.getProposerDutiesV2.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    const first = tracker.getProposer(1);
    const second = tracker.getProposer(2);
    tracker.update(0, "0x11", [
      {slot: 1, validatorIndex: 123, pubkey: Buffer.alloc(48, 123)},
      {slot: 2, validatorIndex: 124, pubkey: Buffer.alloc(48, 124)},
    ]);
    finishOld?.(
      mockApiResponse({
        data: [{slot: 1, validatorIndex: 999, pubkey: Buffer.alloc(48)}],
        meta: {executionOptimistic: false, dependentRoot: "0x00"},
      })
    );

    expect((await first)?.validatorIndex).toBe(123);
    expect((await second)?.validatorIndex).toBe(124);
    expect((await tracker.getProposer(1))?.validatorIndex).toBe(123);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(1);
  });

  it("does not surface an invalidated lookup failure after authoritative duties arrive", async () => {
    let failOld: ((error: Error) => void) | undefined;
    api.validator.getProposerDutiesV2.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failOld = reject;
        })
    );
    const old = tracker.getProposer(1);
    tracker.update(0, "0x11", [{slot: 1, validatorIndex: 123, pubkey: Buffer.alloc(48, 123)}]);
    failOld?.(Error("old branch unavailable"));

    expect((await old)?.validatorIndex).toBe(123);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(1);
  });

  it("invalidates same-epoch cached duties and shares the replacement lookup", async () => {
    await tracker.getProposer(1);
    tracker.invalidate(0);
    api.validator.getProposerDutiesV2.mockResolvedValueOnce(
      mockApiResponse({
        data: [{slot: 1, validatorIndex: 123, pubkey: Buffer.alloc(48, 123)}],
        meta: {executionOptimistic: false, dependentRoot: "0x11"},
      })
    );

    const [first, second] = await Promise.all([tracker.getProposer(1), tracker.getProposer(1)]);
    expect(first?.validatorIndex).toBe(123);
    expect(second?.validatorIndex).toBe(123);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("does not restore an invalidated cache if its replacement lookup fails", async () => {
    await tracker.getProposer(1);
    tracker.invalidate(0);
    api.validator.getProposerDutiesV2.mockRejectedValueOnce(Error("new branch unavailable"));

    await expect(tracker.getProposer(1)).rejects.toThrow("new branch unavailable");
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
    tracker.update(0, "0x11", [{slot: 1, validatorIndex: 123, pubkey: Buffer.alloc(48, 123)}]);
    expect((await tracker.getProposer(1))?.validatorIndex).toBe(123);
  });

  it("ignores an older pending success while the invalidated replacement is still pending", async () => {
    type Response = Awaited<ReturnType<typeof api.validator.getProposerDutiesV2>>;
    const completions: Array<(response: Response) => void> = [];
    api.validator.getProposerDutiesV2.mockImplementation(
      () =>
        new Promise((resolve) => {
          completions.push(resolve);
        })
    );
    const old = tracker.getProposer(1);
    tracker.invalidate(0);
    const replacement = tracker.getProposer(1);
    completions[0](
      mockApiResponse({
        data: [{slot: 1, validatorIndex: 999, pubkey: Buffer.alloc(48)}],
        meta: {executionOptimistic: false, dependentRoot: "0x00"},
      })
    );
    completions[1](
      mockApiResponse({
        data: [{slot: 1, validatorIndex: 123, pubkey: Buffer.alloc(48, 123)}],
        meta: {executionOptimistic: false, dependentRoot: "0x11"},
      })
    );

    expect((await old)?.validatorIndex).toBe(123);
    expect((await replacement)?.validatorIndex).toBe(123);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });

  it("re-fetches primary duties obtained ahead of the epoch and ignores out-of-range updates", async () => {
    tracker.update(1, "0x11", [{slot: SLOTS_PER_EPOCH, validatorIndex: 123, pubkey: Buffer.alloc(48)}]);
    tracker.update(2, "0x22", [{slot: 2 * SLOTS_PER_EPOCH, validatorIndex: 456, pubkey: Buffer.alloc(48)}]);
    expect((await tracker.getProposer(SLOTS_PER_EPOCH))?.validatorIndex).toBe(123);
    clock.currentSlot = SLOTS_PER_EPOCH;

    expect((await tracker.getProposer(SLOTS_PER_EPOCH))?.validatorIndex).toBe(SLOTS_PER_EPOCH);
    expect((await tracker.getProposer(2 * SLOTS_PER_EPOCH))?.validatorIndex).toBe(2 * SLOTS_PER_EPOCH);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
  });
});
