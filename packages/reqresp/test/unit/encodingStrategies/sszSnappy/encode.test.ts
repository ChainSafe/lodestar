import {expect} from "chai";
import all from "it-all";
import {pipe} from "it-pipe";
import varint from "varint";
import {writeSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/encode.js";
import {EncodedPayload, EncodedPayloadType} from "../../../../src/types.js";
import {
  encodingStrategiesEncodingErrorCases,
  encodingStrategiesMainnetTestCases,
  encodingStrategiesTestCases,
} from "../../../fixtures/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {expectEqualByteChunks} from "../../../utils/index.js";

describe("encodingStrategies / sszSnappy / encode", () => {
  for (const {id, type, payload, chunks} of encodingStrategiesTestCases) {
    it(id, async () => {
      const encodedChunks = await pipe(writeSszSnappyPayload(payload as EncodedPayload<unknown>, type), all);
      expectEqualByteChunks(
        encodedChunks,
        chunks.map((c) => c.subarray())
      );
    });
  }

  describe("mainnet cases", () => {
    for (const {id, payload, type: serializer, streamedBody} of encodingStrategiesMainnetTestCases) {
      it(id, async () => {
        const bodySize =
          payload.type === EncodedPayloadType.ssz ? serializer.serialize(payload.data).length : payload.bytes.length;

        const encodedChunks = await pipe(writeSszSnappyPayload(payload, serializer), all);
        const encodedStream = Buffer.concat(encodedChunks);
        const expectedStreamed = Buffer.concat([Buffer.from(varint.encode(bodySize)), streamedBody]);
        expect(encodedStream).to.be.deep.equal(expectedStreamed);
      });
    }
  });

  describe("error cases", () => {
    for (const {id, type, payload, error} of encodingStrategiesEncodingErrorCases) {
      it(id, async () => {
        await expectRejectedWithLodestarError(pipe(writeSszSnappyPayload(payload, type), all), error);
      });
    }
  });
});
