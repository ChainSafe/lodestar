import {afterEach, describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {PayloadIdCache} from "../../../src/execution/engine/payloadIdCache.js";

describe("PayloadIdCache", () => {
  const attributes = {
    headBlockHash: "0x01",
    timestamp: "0x10",
    prevRandao: "0x03",
    suggestedFeeRecipient: "0x04",
  };

  it("misses when the inclusion list transactions differ from the prepared payload", () => {
    const cache = new PayloadIdCache();
    cache.add({...attributes, inclusionListTransactions: SerializedList.fromArray([Uint8Array.of(0xaa)])}, "0x1234");

    expect(
      cache.get({...attributes, inclusionListTransactions: SerializedList.fromArray([Uint8Array.of(0xaa)])})
    ).toMatchObject({payloadId: "0x1234"});
    expect(
      cache.get({...attributes, inclusionListTransactions: SerializedList.fromArray([Uint8Array.of(0xab)])})
    ).toBeUndefined();
    expect(
      cache.get({
        ...attributes,
        inclusionListTransactions: SerializedList.fromArray([Uint8Array.of(0xaa), Uint8Array.of(0xbb)]),
      })
    ).toBeUndefined();
    expect(cache.get(attributes)).toBeUndefined();
  });

  it("records when the payload was requested on the monotonic clock", () => {
    vi.useFakeTimers({toFake: ["performance"]});
    const cache = new PayloadIdCache();
    const requestedAtMs = performance.now();
    cache.add(attributes, "0x1234");
    vi.advanceTimersByTime(300);

    expect(cache.get(attributes)).toEqual({payloadId: "0x1234", preparedAtMs: requestedAtMs});
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
