import {describe, expect, it} from "vitest";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {PeerAction} from "../../../../src/network/peers/score/index.js";
import {onOutgoingReqRespError} from "../../../../src/network/reqresp/score.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";

describe("network / reqresp / score", () => {
  it("does not downscore peer on reqresp rate-limit server errors", () => {
    const err = new RequestError({
      code: RequestErrorCode.SERVER_ERROR,
      errorMessage: RequestErrorCode.REQUEST_RATE_LIMITED,
    });

    const action = onOutgoingReqRespError(err, ReqRespMethod.BeaconBlocksByRange);
    expect(action).toBeNull();
  });

  it("keeps downscoring on non-rate-limit server errors", () => {
    const err = new RequestError({
      code: RequestErrorCode.SERVER_ERROR,
      errorMessage: "unexpected internal failure",
    });

    const action = onOutgoingReqRespError(err, ReqRespMethod.BeaconBlocksByRange);
    expect(action).toBe(PeerAction.MidToleranceError);
  });
});
