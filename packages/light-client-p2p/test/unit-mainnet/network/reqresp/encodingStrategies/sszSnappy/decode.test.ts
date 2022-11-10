import {expect} from "chai";
import varint from "varint";
import {Uint8ArrayList} from "uint8arraylist";
import {arrToSource} from "@lodestar/beacon-node/test/unit/network/reqresp/utils";
import {readSszSnappyPayload} from "@lodestar/beacon-node/network/reqresp/encodingStrategies/sszSnappy";
import {BufferedSource} from "@lodestar/beacon-node/network/reqresp/utils";
import {isEqualSszType} from "../../../../../utils/ssz.js";
import {goerliShadowForkBlock13249} from "./testData.js";

describe("network / reqresp / sszSnappy / decode", () => {
  describe("Test data vectors (generated in a previous version)", () => {
    const testCases = [goerliShadowForkBlock13249];

    for (const {id, type, bytes, streamedBody, body} of testCases) {
      const deserializedBody = body ?? type.deserialize(Buffer.from(bytes));
      const streamedBytes = new Uint8ArrayList(Buffer.concat([Buffer.from(varint.encode(bytes.length)), streamedBody]));

      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource([streamedBytes]));
        const bodyResult = await readSszSnappyPayload(bufferedSource, type);
        expect(isEqualSszType(type, bodyResult, deserializedBody)).to.equal(true, "Wrong decoded body");
      });
    }
  });
});
