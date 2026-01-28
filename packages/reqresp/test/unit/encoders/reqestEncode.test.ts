import {describe, it} from "vitest";
import {encodeRequest} from "../../../src/encoders/requestEncode.js";
import {requestEncodersCases} from "../../fixtures/encoders.js";
import {expectEqualByteChunks} from "../../utils/index.js";

describe("encoders / requestEncode", () => {
  describe("valid cases", () => {
    it.each(requestEncodersCases)("$id", async ({protocol, requestBody, chunks}) => {
      // Encode request using new synchronous API
      const encoded = encodeRequest(protocol, requestBody);
      
      // Compare with expected chunks
      expectEqualByteChunks(
        [encoded.subarray()],
        chunks.length > 0 ? [Buffer.concat(chunks.map((c) => c.subarray()))] : []
      );
    });
  });
});
