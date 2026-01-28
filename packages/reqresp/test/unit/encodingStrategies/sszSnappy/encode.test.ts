import {encode as varintEncode} from "uint8-varint";
import {describe, expect, it} from "vitest";
import {encodeSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/encode.js";
import {encodingStrategiesMainnetTestCases, encodingStrategiesTestCases} from "../../../fixtures/index.js";
import {expectEqualByteChunks} from "../../../utils/index.js";

describe("encodingStrategies / sszSnappy / encode", () => {
  it.each(encodingStrategiesTestCases)("$id", async ({binaryPayload, chunks}) => {
    const encoded = encodeSszSnappyPayload(binaryPayload.data);
    const expectedConcat = Buffer.concat(chunks.map((c) => c.subarray()));
    
    expectEqualByteChunks(
      [encoded.subarray()],
      [expectedConcat]
    );
  });

  describe("mainnet cases", () => {
    it.each(encodingStrategiesMainnetTestCases)("$id", async ({payload, streamedBody}) => {
      const bodySize = payload.data.length;

      const encoded = encodeSszSnappyPayload(payload.data);
      const expectedStreamed = Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]);
      
      expect(Buffer.from(encoded.subarray())).toEqual(expectedStreamed);
    });
  });
});
