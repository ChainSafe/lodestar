import {expect} from "chai";
import all from "it-all";
import {pipe} from "it-pipe";
import {encode as varintEncode} from "uint8-varint";
import {writeSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/encode.js";
import {encodingStrategiesMainnetTestCases, encodingStrategiesTestCases} from "../../../fixtures/index.js";
import {expectEqualByteChunks} from "../../../utils/index.js";

describe("encodingStrategies / sszSnappy / encode", () => {
  for (const {id, binaryPayload, chunks} of encodingStrategiesTestCases) {
    it(id, async () => {
      const encodedChunks = await pipe(writeSszSnappyPayload(binaryPayload.data), all);
      expectEqualByteChunks(
        encodedChunks as Uint8Array[],
        chunks.map((c) => c.subarray())
      );
    });
  }

  describe("mainnet cases", () => {
    for (const {id, payload, streamedBody} of encodingStrategiesMainnetTestCases) {
      it(id, async () => {
        const bodySize = payload.data.length;

        const encodedChunks = await pipe(writeSszSnappyPayload(payload.data), all);
        const encodedStream = Buffer.concat(encodedChunks as Uint8Array[]);
        const expectedStreamed = Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]);
        expect(encodedStream).to.be.deep.equal(expectedStreamed);
      });
    }
  });
});
