import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import varint from "varint";
import {BufferedSource} from "../../../../../../src/network/reqresp/utils";
import {readSszSnappyPayload} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {isEqualSszType} from "../../../../../utils/ssz";
import {arrToSource} from "../../../../../../test/unit/network/reqresp/utils";
import {goerliShadowForkBlock13249} from "./testData";

chai.use(chaiAsPromised);

describe("network / reqresp / sszSnappy / decode", () => {
  describe("Test data vectors (generated in a previous version)", () => {
    const testCases = [goerliShadowForkBlock13249];

    for (const {id, type, bytes, streamedBody, body} of testCases) {
      const deserializedBody = body ?? type.deserialize(Buffer.from(bytes));
      const streamedBytes = Buffer.concat([Buffer.from(varint.encode(bytes.length)), streamedBody]);

      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource([streamedBytes]));
        const bodyResult = await readSszSnappyPayload(bufferedSource, type);
        expect(isEqualSszType(type, bodyResult, deserializedBody)).to.equal(true, "Wrong decoded body");
      });
    }
  });
});
