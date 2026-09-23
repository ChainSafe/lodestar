import {describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {RequestError, RequestErrorCode, ResponseIncoming} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {
  collectExactOneTyped,
  collectMaxResponseTyped,
  collectMaxResponseTypedWithBytes,
} from "../../../../src/network/reqresp/utils/collect.js";
import {collectSequentialBlocksInRange} from "../../../../src/network/reqresp/utils/collectSequentialBlocksInRange.js";

const type = ssz.phase0.SignedBeaconBlock;
const collectors = {
  exact: (source: AsyncIterable<ResponseIncoming>, report: () => void) =>
    collectExactOneTyped(source, () => type, report),
  maximum: (source: AsyncIterable<ResponseIncoming>, report: () => void) =>
    collectMaxResponseTyped(source, 2, () => type, undefined, report),
  withBytes: (source: AsyncIterable<ResponseIncoming>, report: () => void) =>
    collectMaxResponseTypedWithBytes(source, 2, () => type, undefined, report),
  sequential: (source: AsyncIterable<ResponseIncoming>, report: () => void) =>
    collectSequentialBlocksInRange(source, {startSlot: 0, count: 2}, undefined, report),
};

async function* response(data: Uint8Array): AsyncGenerator<ResponseIncoming> {
  yield {data, fork: ForkName.phase0, protocolVersion: 1};
}

for (const [name, collect] of Object.entries(collectors)) {
  describe(name, () => {
    it("reports its own SSZ failure exactly once", async () => {
      const report = vi.fn();
      await expect(collect(response(new Uint8Array(1)), report)).rejects.toMatchObject({
        type: {code: RequestErrorCode.INVALID_RESPONSE_SSZ},
      });
      expect(report).toHaveBeenCalledOnce();
    });

    it("does not re-report a native or libp2p iterator failure", async () => {
      const report = vi.fn();
      const error = new RequestError({code: RequestErrorCode.INVALID_RESPONSE_SSZ, errorMessage: "framing"});
      const source: AsyncIterable<ResponseIncoming> = {
        [Symbol.asyncIterator]() {
          return {next: async () => Promise.reject(error)};
        },
      };
      await expect(collect(source, report)).rejects.toBe(error);
      expect(report).not.toHaveBeenCalled();
    });

    it("does not report a valid response", async () => {
      const report = vi.fn();
      await collect(response(type.serialize(type.defaultValue())), report);
      expect(report).not.toHaveBeenCalled();
    });
  });
}

it("keeps block sequence validation separate from deserialization", async () => {
  const report = vi.fn();
  const block = type.defaultValue();
  block.message.slot = 2;
  await expect(collectors.sequential(response(type.serialize(block)), report)).rejects.toThrow();
  expect(report).not.toHaveBeenCalled();
});
