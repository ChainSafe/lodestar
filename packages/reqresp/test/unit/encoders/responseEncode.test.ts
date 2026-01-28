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
        // Encode response chunks using new synchronous API
        const encodedChunks = responseEncode(responseChunks, protocol as Protocol);

        // Flatten encoded chunks to compare with expected
        const encodedBytes = encodedChunks.map((c) => c.subarray());

        expectEqualByteChunks(
          encodedBytes,
          chunks.map((c) => c.subarray())
        );
      }
    );
  });
});
