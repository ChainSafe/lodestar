import {encode as varintEncode} from "uint8-varint";
import {describe, expect, it} from "vitest";
import {writeSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/encode.js";
import {encodingStrategiesMainnetTestCases, encodingStrategiesTestCases} from "../../../fixtures/index.js";
import {expectEqualByteChunks} from "../../../utils/index.js";

describe("encodingStrategies / sszSnappy / encode", () => {
  it.each(encodingStrategiesTestCases)("$id", async ({binaryPayload, chunks}) => {
    const encodedChunks = await Array.fromAsync(writeSszSnappyPayload(Buffer.from(binaryPayload.data)));
    expectEqualByteChunks(
      encodedChunks,
      chunks.map((c) => c.subarray())
    );
  });

  describe("mainnet cases", () => {
    it.each(encodingStrategiesMainnetTestCases)("$id", async ({payload, streamedBody}) => {
      const bodySize = payload.data.length;

      const encodedChunks = await Array.fromAsync(writeSszSnappyPayload(Buffer.from(payload.data)));
      const encodedStream = Buffer.concat(encodedChunks);
      const expectedStreamed = Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]);
      expect(encodedStream).toEqual(expectedStreamed);
    });
  });
});
