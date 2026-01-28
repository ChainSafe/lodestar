import {byteStream} from "@libp2p/utils/byte-stream";
import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {decodeRequest} from "../../../src/encoders/requestDecode.js";
import {requestEncodersCases, requestEncodersErrorCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {MockLibP2pStream} from "../../utils/index.js";

describe("encoders / requestDecode", () => {
  describe("valid cases", () => {
    it.each(requestEncodersCases)("$id", async ({protocol, requestBody, chunks}) => {
      // Create mock stream with input chunks
      const inputChunks = chunks.map((c) => new Uint8ArrayList(c));
      const mockStream = new MockLibP2pStream(inputChunks, protocol.method);
      const bytes = byteStream(mockStream);

      // Decode request using new API
      const decodedBody = await decodeRequest(bytes, protocol);
      expect(decodedBody).toEqual(requestBody);
    });
  });

  describe("error cases", () => {
    it.each(requestEncodersErrorCases.filter((r) => r.errorDecode))("$id", async ({protocol, errorDecode, chunks}) => {
      // Create mock stream with input chunks
      const inputChunks = chunks.map((c) => new Uint8ArrayList(c));
      const mockStream = new MockLibP2pStream(inputChunks, protocol.method);
      const bytes = byteStream(mockStream);

      await expectRejectedWithLodestarError(decodeRequest(bytes, protocol), errorDecode);
    });
  });
});
