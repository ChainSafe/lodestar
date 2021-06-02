import all from "it-all";
import pipe from "it-pipe";
import {ssz} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {RequestOrResponseBody, RequestOrResponseType} from "../../../../../../src/network/reqresp/types";
import {
  SszSnappyError,
  SszSnappyErrorCode,
  writeSszSnappyPayload,
} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {expectRejectedWithLodestarError} from "../../../../../utils/errors";
import {expectEqualByteChunks} from "../../utils";
import {sszSnappyPing, sszSnappyStatus, sszSnappySignedBeaconBlockPhase0} from "./testData";

describe("network / reqresp / sszSnappy / encode", () => {
  describe("Test data vectors (generated in a previous version)", () => {
    const testCases = [sszSnappyPing, sszSnappyStatus, sszSnappySignedBeaconBlockPhase0];

    for (const {id, type, body, chunks} of testCases) {
      it(id, async () => {
        const encodedChunks = await pipe(writeSszSnappyPayload(body, type), all);
        expectEqualByteChunks(encodedChunks, chunks);
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
        type: ssz.phase0.Status,
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
