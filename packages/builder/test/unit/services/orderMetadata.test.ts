import {describe, expect, it} from "vitest";
import {parseOrderMetadata} from "../../../src/services/orderMetadata.js";

describe("immutable order metadata", () => {
  const orderIds = Array.from({length: 256}, (_, n) => `0x${n.toString(16).padStart(64, "0")}`);

  it("copies and freezes the maximum membership without conflating unknown and empty", () => {
    const input = [...orderIds].reverse();
    const parsed = parseOrderMetadata({version: 1, orderIds: input, doNotOfferBefore: 0});
    input.pop();
    expect(parsed?.orderIds).toEqual(orderIds);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.orderIds)).toBe(true);
    expect(parseOrderMetadata(undefined)).toBeUndefined();
    expect(parseOrderMetadata({version: 1, orderIds: null, doNotOfferBefore: 123})?.orderIds).toBeNull();
    expect(parseOrderMetadata({version: 1, orderIds: [], doNotOfferBefore: 0})?.orderIds).toEqual([]);
  });

  it.each([
    {version: 2},
    {orderIds: [...orderIds, `0x${"ff".repeat(32)}`]},
    {orderIds: [orderIds[0], orderIds[0]]},
    {orderIds: ["0x12"]},
    {orderIds: [`0x${"AB".repeat(32)}`]},
    {doNotOfferBefore: -1},
    {doNotOfferBefore: 0.5},
    {doNotOfferBefore: Number.MAX_SAFE_INTEGER + 1},
  ])("refuses malformed or unbounded metadata: %j", (changed) => {
    expect(() => parseOrderMetadata({version: 1, orderIds, doNotOfferBefore: 0, ...changed})).toThrow(
      "ORDER_METADATA_INVALID"
    );
  });
});
