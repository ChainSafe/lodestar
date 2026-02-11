import {byteStream} from "@libp2p/utils";
import {encode as varintEncode} from "uint8-varint";
import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {readSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/index.js";
import {
  encodingStrategiesDecodingErrorCases,
  encodingStrategiesMainnetTestCases,
  encodingStrategiesTestCases,
} from "../../../fixtures/index.js";
import {arrToSource} from "../../../utils/index.js";
import {createMockStream} from "../../../utils/mockStream.js";

describe("encodingStrategies / sszSnappy / decode", () => {
  it.each(encodingStrategiesTestCases)("$id", async ({type, binaryPayload, chunks}) => {
    const {stream} = await createMockStream({source: arrToSource(chunks)});
    const bytes = byteStream(stream);
    const bodyResult = await readSszSnappyPayload(bytes, type).finally(() => bytes.unwrap());
    expect(bodyResult).toEqual(binaryPayload.data);
  });

  describe("mainnet cases", () => {
    for (const {id, payload, type: serializer, streamedBody} of encodingStrategiesMainnetTestCases) {
      const bodySize = payload.data.length;
      const streamedBytes = new Uint8ArrayList(Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]));

      it(id, async () => {
        const {stream} = await createMockStream({source: arrToSource([streamedBytes])});
        const bytes = byteStream(stream);
        const bodyResult = await readSszSnappyPayload(bytes, serializer).finally(() => bytes.unwrap());

        expect(bodyResult).toEqual(new Uint8Array(payload.data));
      });
    }
  });

  describe("error cases", () => {
    for (const {id, type, error, chunks} of encodingStrategiesDecodingErrorCases) {
      it(id, async () => {
        const {stream} = await createMockStream({source: arrToSource([new Uint8ArrayList(...chunks)])});
        const bytes = byteStream(stream);
        await expect(readSszSnappyPayload(bytes, type)).rejects.toThrow(error);
        bytes.unwrap();
      });
    }
  });
});
