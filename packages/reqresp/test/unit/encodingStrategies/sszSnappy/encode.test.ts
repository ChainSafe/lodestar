import {expect} from "chai";
import all from "it-all";
import {pipe} from "it-pipe";
import varint from "varint";
import {writeSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/encode.js";
import {EncodedPayloadType} from "../../../../src/types.js";
import {goerliShadowForkBlock13249} from "../../../fixtures/index.js";

describe("encodingStrategies", () => {
  describe("sszSnappy - encoding", () => {
    const testCases = [goerliShadowForkBlock13249];

    for (const {id, payload, serializer, streamedBody} of testCases) {
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
});
