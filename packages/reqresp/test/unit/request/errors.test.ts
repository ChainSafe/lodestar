import {describe, expect, it} from "vitest";
import {RespStatus} from "../../../src/interface.js";
import {RequestErrorCode, responseStatusErrorToRequestError} from "../../../src/request/errors.js";
import {ResponseError} from "../../../src/response/index.js";

describe("responseStatusErrorToRequestError", () => {
  const rateLimitMessages = [
    "rate limited",
    "Peer has been rate limited",
    "Rate limited. There are already 2 active requests with the same protocol",
    "Wait 2.816488536s",
  ];

  for (const errorMessage of rateLimitMessages) {
    it(`maps "${errorMessage}" to RESP_RATE_LIMITED`, () => {
      expect(responseStatusErrorToRequestError(new ResponseError(RespStatus.INVALID_REQUEST, errorMessage))).toEqual({
        code: RequestErrorCode.RESP_RATE_LIMITED,
      });
    });
  }

  it("maps non-rate-limit invalid request errors", () => {
    const errorMessage = "bad request";
    expect(responseStatusErrorToRequestError(new ResponseError(RespStatus.INVALID_REQUEST, errorMessage))).toEqual({
      code: RequestErrorCode.INVALID_REQUEST,
      errorMessage,
    });
  });
});
