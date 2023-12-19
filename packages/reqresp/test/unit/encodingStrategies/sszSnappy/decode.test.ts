import {describe, it, expect} from "vitest";
import {Uint8ArrayList} from "uint8arraylist";
import {encode as varintEncode} from "uint8-varint";
import {readSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/index.js";
import {BufferedSource} from "../../../../src/utils/index.js";
import {
  encodingStrategiesDecodingErrorCases,
  encodingStrategiesMainnetTestCases,
  encodingStrategiesTestCases,
} from "../../../fixtures/index.js";
import {arrToSource} from "../../../utils/index.js";

describe("encodingStrategies / sszSnappy / decode", () => {
  it.each(encodingStrategiesTestCases)("$id", async ({type, binaryPayload, chunks}) => {
    const bufferedSource = new BufferedSource(arrToSource(chunks));
    const bodyResult = await readSszSnappyPayload(bufferedSource, type);
    expect(bodyResult).toEqual(binaryPayload.data);
  });

  describe("mainnet cases", () => {
    for (const {id, payload, type: serializer, streamedBody} of encodingStrategiesMainnetTestCases) {
      const bodySize = payload.data.length;
      const streamedBytes = new Uint8ArrayList(Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]));

      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource([streamedBytes]));
        const bodyResult = await readSszSnappyPayload(bufferedSource, serializer);

        expect(bodyResult).toEqual(new Uint8Array(payload.data));
      });
    }
  });

  describe("error cases", () => {
    for (const {id, type, error, chunks} of encodingStrategiesDecodingErrorCases) {
      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource([new Uint8ArrayList(...chunks)]));
        await expect(readSszSnappyPayload(bufferedSource, type)).rejects.toThrow(error);
      });
    }
  });
});
