import all from "it-all";
import {pipe} from "it-pipe";
import {expect} from "chai";
import varint from "varint";

import {allForks, ssz} from "@lodestar/types";

import {reqRespBlockResponseSerializer} from "../../../../../../src/network/reqresp/types.js";
import {writeSszSnappyPayload} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy/index.js";
import {RequestOrOutgoingResponseBody} from "../../../../../../src/network/reqresp/types.js";
import {goerliShadowForkBlock13249} from "./testData.js";

describe("network / reqresp / sszSnappy / encode", () => {
  describe("Test data vectors (generated in a previous version)", () => {
    const testCases = [goerliShadowForkBlock13249];

    for (const testCase of testCases) {
      const {id, type, bytes, streamedBody, body} = testCase;
      const deserializedBody = body ?? type.deserialize(Buffer.from(bytes));
      const reqrespBody =
        body ??
        (type === ssz.bellatrix.SignedBeaconBlock
          ? {slot: (deserializedBody as allForks.SignedBeaconBlock).message.slot, bytes}
          : deserializedBody);

      it(id, async () => {
        const encodedChunks = await pipe(
          writeSszSnappyPayload(reqrespBody as RequestOrOutgoingResponseBody, reqRespBlockResponseSerializer),
          all
        );
        const encodedStream = Buffer.concat(encodedChunks);
        const expectedStreamed = Buffer.concat([Buffer.from(varint.encode(bytes.length)), streamedBody]);
        expect(encodedStream).to.be.deep.equal(expectedStreamed);
      });
    }
  });
});
