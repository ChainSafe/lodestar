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
  const testCases: {
    id: string;
    type: RequestOrResponseType;
    body: RequestOrResponseBody;
    error?: LodestarError<any>;
    chunks?: string[];
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
    {id: "Uint8 type", ...sszSnappyPing},
    {id: "Struct type", ...sszSnappyStatus},
    {id: "Complex big type", ...sszSnappySignedBlock},
  ];

  for (const {id, type, body, error, chunks} of testCases) {
    it(id, async () => {
      const resultPromise = pipe(writeSszSnappyPayload(body, type), all);

      if (chunks) {
        const encodedChunks = await resultPromise;
        expect(encodedChunks.map(toHexString)).to.deep.equal(chunks);
      } else if (error) {
        await expectRejectedWithLodestarError(resultPromise, error);
      } else {
        throw Error("Bad test data");
      }
    });
  }
});
