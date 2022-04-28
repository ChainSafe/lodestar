import all from "it-all";
import pipe from "it-pipe";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {
  reqRespBlockResponseSerializer,
  RequestOrIncomingResponseBody,
  RequestOrResponseType,
} from "../../../../../../src/network/reqresp/types";
import {
  SszSnappyError,
  SszSnappyErrorCode,
  writeSszSnappyPayload,
} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {expectRejectedWithLodestarError} from "../../../../../utils/errors";
import {expectEqualByteChunks} from "../../utils";
import {sszSnappyPing, sszSnappyStatus, sszSnappySignedBeaconBlockPhase0} from "./testData";
import {blocksToReqRespBlockResponses} from "../../../../../utils/block";
import {RequestOrOutgoingResponseBody} from "../../../../../../src/network/reqresp/types";

describe("network / reqresp / sszSnappy / encode", () => {
  describe("Test data vectors (generated in a previous version)", () => {
    const testCases = [sszSnappyPing, sszSnappyStatus, sszSnappySignedBeaconBlockPhase0];

    for (const testCase of testCases) {
      const {id, type, chunks} = testCase;
      it(id, async () => {
        const body =
          type === ssz.phase0.SignedBeaconBlock
            ? blocksToReqRespBlockResponses([testCase.body] as allForks.SignedBeaconBlock[])[0]
            : testCase.body;
        const encodedChunks = await pipe(
          writeSszSnappyPayload(
            body as RequestOrOutgoingResponseBody,
            type === ssz.phase0.SignedBeaconBlock ? reqRespBlockResponseSerializer : type
          ),
          all
        );
        expectEqualByteChunks(encodedChunks, chunks);
      });
    }
  });

  describe("Error cases", () => {
    const testCases: {
      id: string;
      type: RequestOrResponseType;
      body: RequestOrIncomingResponseBody;
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
        await expectRejectedWithLodestarError(
          pipe(writeSszSnappyPayload(body as RequestOrOutgoingResponseBody, type), all),
          error
        );
      });
    }
  });
});
