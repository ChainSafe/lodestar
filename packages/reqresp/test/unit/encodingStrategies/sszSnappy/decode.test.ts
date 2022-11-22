import {expect} from "chai";
import varint from "varint";
import {Uint8ArrayList} from "uint8arraylist";
import {BufferedSource} from "../../../../src/utils/bufferedSource.js";
import {readSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/decode.js";
import {arrToSource} from "../../../utils/index.js";
import {isEqualSszType} from "../../../utils/ssz.js";
import {EncodedPayloadType} from "../../../../src/types.js";
import {goerliShadowForkBlock13249} from "../../../fixtures/index.js";

describe("encodingStrategies", () => {
  describe("sszSnappy - decoding", () => {
    const testCases = [goerliShadowForkBlock13249];

    for (const {id, payload, serializer, streamedBody} of testCases) {
      const bodySize =
        payload.type === EncodedPayloadType.ssz ? serializer.serialize(payload.data).length : payload.bytes.length;
      const deserializedBody =
        payload.type === EncodedPayloadType.ssz ? payload : serializer.deserialize(Buffer.from(payload.bytes));

      const streamedBytes = new Uint8ArrayList(Buffer.concat([Buffer.from(varint.encode(bodySize)), streamedBody]));

      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource([streamedBytes]));
        const bodyResult = await readSszSnappyPayload(bufferedSource, serializer);
        expect(isEqualSszType(serializer, bodyResult, deserializedBody)).to.equal(true, "Wrong decoded body");
      });
    }
  });
});
