import {byteStream} from "@libp2p/utils/byte-stream";
import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {LodestarError} from "@lodestar/utils";
import {decodeResponse} from "../../../src/encoders/responseDecode.js";
import {ResponseIncoming} from "../../../src/types.js";
import {responseEncodersErrorTestCases, responseEncodersTestCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {MockLibP2pStream, onlySuccessResp} from "../../utils/index.js";

describe("encoders / responseDecode", () => {
  describe("valid cases", () => {
    it.each(responseEncodersTestCases)("$id", async ({protocol, responseChunks, chunks}) => {
      // Create mock stream with input chunks
      const inputChunks = chunks.map((c) => new Uint8ArrayList(c));
      const mockStream = new MockLibP2pStream(inputChunks, protocol.method);
      const bytes = byteStream(mockStream);

      // Decode responses
      const responses: ResponseIncoming[] = [];
      for await (const response of decodeResponse(bytes, protocol)) {
        responses.push(response);
      }

      const expectedResponses = responseChunks.filter(onlySuccessResp).map((r) => r.payload);
      expect(responses.map((r) => ({...r, data: Buffer.from(r.data)}))).toEqual(
        expectedResponses.map((r) => ({...r, data: Buffer.from(r.data)}))
      );
    });
  });

  describe("error cases", () => {
    it.each(responseEncodersErrorTestCases.filter((r) => r.decodeError !== undefined))(
      "$id",
      async ({protocol, chunks, decodeError}) => {
        // Create mock stream with input chunks
        const inputChunks = (chunks as Uint8Array[]).map((c) => new Uint8ArrayList(c));
        const mockStream = new MockLibP2pStream(inputChunks, protocol.method);
        const bytes = byteStream(mockStream);

        // Wrap in async function for error handling
        const decodeAll = async (): Promise<ResponseIncoming[]> => {
          const responses: ResponseIncoming[] = [];
          for await (const response of decodeResponse(bytes, protocol)) {
            responses.push(response);
          }
          return responses;
        };

        await expectRejectedWithLodestarError(decodeAll(), decodeError as LodestarError<any>);
      }
    );
  });
});
