import {expect} from "chai";
import all from "it-all";
import pipe from "it-pipe";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/minimal";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {RequestOrResponseBody, RequestOrResponseType} from "../../../../../../src/network";
import {
  SszSnappyError,
  SszSnappyErrorCode,
  writeSszSnappyPayload,
} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {expectRejectedWithLodestarError} from "../../../../../utils/errors";
import {sszSnappyPing, sszSnappyStatus, sszSnappySignedBlock} from "./testData";

describe("network / reqresp / sszSnappy / encode", () => {
  describe("Test data vectors (generated in a previous version)", () => {
    const testCases = [sszSnappyPing, sszSnappyStatus, sszSnappySignedBlock];

    for (const {id, type, body, chunks} of testCases) {
      it(id, async () => {
        const encodedChunks = await pipe(writeSszSnappyPayload(body, type), all);
        expect(encodedChunks.map(toHexString)).to.deep.equal(chunks);
      });
    }
  });

  describe("Error cases", () => {
    const testCases: {
      id: string;
      type: RequestOrResponseType;
      body: RequestOrResponseBody;
      error: LodestarError<any>;
    }[] = [
      {
        id: "Bad body",
        type: config.types.Status,
        body: BigInt(1),
        error: new SszSnappyError({
          code: SszSnappyErrorCode.SERIALIZE_ERROR,
          serializeError: new TypeError("Cannot convert undefined or null to object"),
        }),
      },
    ];

    for (const {id, type, body, error} of testCases) {
      it(id, async () => {
        await expectRejectedWithLodestarError(pipe(writeSszSnappyPayload(body, type), all), error);
      });
    }
  });
});
