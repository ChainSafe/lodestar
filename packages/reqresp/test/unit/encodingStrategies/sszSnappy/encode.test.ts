import {describe, it, expect} from "vitest";
import all from "it-all";
import {pipe} from "it-pipe";
import {encode as varintEncode} from "uint8-varint";
import {writeSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/encode.js";
import {encodingStrategiesMainnetTestCases, encodingStrategiesTestCases} from "../../../fixtures/index.js";
import {expectEqualByteChunks} from "../../../utils/index.js";

describe("encodingStrategies / sszSnappy / encode", () => {
  it.each(encodingStrategiesTestCases)("$id", async ({binaryPayload, chunks}) => {
    const encodedChunks = await pipe(writeSszSnappyPayload(Buffer.from(binaryPayload.data)), all);
    expectEqualByteChunks(
      encodedChunks as Uint8Array[],
      chunks.map((c) => c.subarray())
    );
  });

  describe("mainnet cases", () => {
    it.each(encodingStrategiesMainnetTestCases)("$id", async ({payload, streamedBody}) => {
      const bodySize = payload.data.length;

      const encodedChunks = await pipe(writeSszSnappyPayload(Buffer.from(payload.data)), all);
      const encodedStream = Buffer.concat(encodedChunks as Uint8Array[]);
      const expectedStreamed = Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]);
      expect(encodedStream).toEqual(expectedStreamed);
    });
  });
});
