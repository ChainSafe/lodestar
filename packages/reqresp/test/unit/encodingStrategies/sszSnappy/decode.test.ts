import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {Uint8ArrayList} from "uint8arraylist";
import varint from "varint";
import {readSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/index.js";
import {EncodedPayloadType} from "../../../../src/types.js";
import {BufferedSource} from "../../../../src/utils/index.js";
import {
  encodingStrategiesDecodingErrorCases,
  encodingStrategiesMainnetTestCases,
  encodingStrategiesTestCases,
} from "../../../fixtures/index.js";
import {arrToSource} from "../../../utils/index.js";
import {isEqualSszType} from "../../../utils/ssz.js";

chai.use(chaiAsPromised);

describe("encodingStrategies / sszSnappy / decode", () => {
  for (const {id, type, payload, chunks} of encodingStrategiesTestCases) {
    it(id, async () => {
      const bufferedSource = new BufferedSource(arrToSource(chunks));
      const bodyResult = await readSszSnappyPayload(bufferedSource, type);
      expect(isEqualSszType(type, bodyResult, payload.data)).to.equal(true, "Wrong decoded body");
    });
  }

  describe("mainnet cases", () => {
    for (const {id, payload, type: serializer, streamedBody} of encodingStrategiesMainnetTestCases) {
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

  describe("error cases", () => {
    for (const {id, type, error, chunks} of encodingStrategiesDecodingErrorCases) {
      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource([new Uint8ArrayList(...chunks)]));
        await expect(readSszSnappyPayload(bufferedSource, type)).to.be.rejectedWith(error);
      });
    }
  });
});
