import {byteStream} from "@libp2p/utils";
import {encode as varintEncode} from "uint8-varint";
import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {decodeSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/index.js";
import {
  encodingStrategiesDecodingErrorCases,
  encodingStrategiesMainnetTestCases,
  encodingStrategiesTestCases,
} from "../../../fixtures/index.js";
import {MockLibP2pStream} from "../../../utils/index.js";

describe("encodingStrategies / sszSnappy / decode", () => {
  it.each(encodingStrategiesTestCases)("$id", async ({type, binaryPayload, chunks}) => {
    const inputChunks = chunks.map((c) => new Uint8ArrayList(c));
    const mockStream = new MockLibP2pStream(inputChunks, "test");
    const bytes = byteStream(mockStream);
    
    const bodyResult = await decodeSszSnappyPayload(bytes, type);
    expect(bodyResult).toEqual(binaryPayload.data);
  });

  describe("mainnet cases", () => {
    for (const {id, payload, type: serializer, streamedBody} of encodingStrategiesMainnetTestCases) {
      const bodySize = payload.data.length;
      const streamedBytes = new Uint8ArrayList(Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]));

      it(id, async () => {
        const mockStream = new MockLibP2pStream([streamedBytes], "test");
        const bytes = byteStream(mockStream);
        
        const bodyResult = await decodeSszSnappyPayload(bytes, serializer);
        expect(bodyResult).toEqual(new Uint8Array(payload.data));
      });
    }
  });

  describe("error cases", () => {
    for (const {id, type, error, chunks} of encodingStrategiesDecodingErrorCases) {
      it(id, async () => {
        const inputChunks = [new Uint8ArrayList(...chunks)];
        const mockStream = new MockLibP2pStream(inputChunks, "test");
        const bytes = byteStream(mockStream);
        
        await expect(decodeSszSnappyPayload(bytes, type)).rejects.toThrow(error);
      });
    }
  });
});
