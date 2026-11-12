import {describe, it} from "vitest";
import {Protocol} from "../../../src/types.js";
import {responseEncodersTestCases} from "../../fixtures/encoders.js";
import {expectEqualByteChunks} from "../../utils/index.js";
import {responseEncode} from "../../utils/response.js";

describe("encoders / responseEncode", () => {
  describe("valid cases", () => {
    it.each(responseEncodersTestCases.filter((f) => !f.skipEncoding))(
      "$id",
      async ({protocol, responseChunks, chunks}) => {
        const encodedChunks = await Array.fromAsync(responseEncode(responseChunks, protocol as Protocol));
        expectEqualByteChunks(
          encodedChunks,
          chunks.map((c) => c.subarray())
        );
      }
    );
  });
});
