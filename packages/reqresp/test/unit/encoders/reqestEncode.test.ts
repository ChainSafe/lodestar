import {describe, it} from "vitest";
import {requestEncode} from "../../../src/encoders/requestEncode.js";
import {requestEncodersCases} from "../../fixtures/encoders.js";
import {expectEqualByteChunks} from "../../utils/index.js";

describe("encoders / requestEncode", () => {
  describe("valid cases", () => {
    it.each(requestEncodersCases)("$id", async ({protocol, requestBody, chunks}) => {
      const encodedChunks = await Array.fromAsync(requestEncode(protocol, requestBody));
      expectEqualByteChunks(
        encodedChunks,
        chunks.map((c) => c.subarray())
      );
    });
  });
});
