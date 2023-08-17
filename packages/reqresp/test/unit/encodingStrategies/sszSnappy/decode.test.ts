import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
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

chai.use(chaiAsPromised);

describe("encodingStrategies / sszSnappy / decode", () => {
  for (const {id, type, binaryPayload, chunks} of encodingStrategiesTestCases) {
    it(id, async () => {
      const bufferedSource = new BufferedSource(arrToSource(chunks));
      const bodyResult = await readSszSnappyPayload(bufferedSource, type);
      expect(bodyResult).to.deep.equal(binaryPayload.data, "Wrong decoded body");
    });
  }

  describe("mainnet cases", () => {
    for (const {id, payload, type: serializer, streamedBody} of encodingStrategiesMainnetTestCases) {
      const bodySize = payload.data.length;
      const streamedBytes = new Uint8ArrayList(Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]));

      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource([streamedBytes]));
        const bodyResult = await readSszSnappyPayload(bufferedSource, serializer);

        expect(bodyResult).to.deep.equal(payload.data, "Wrong decoded body");
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
