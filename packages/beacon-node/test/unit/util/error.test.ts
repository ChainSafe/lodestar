import v8 from "node:v8";
import {describe, it, expect} from "vitest";
import {RequestError, RequestErrorCode, RespStatus, ResponseError} from "@lodestar/reqresp";
import {fromThreadBoundaryError, toThreadBoundaryError} from "../../../src/util/error.js";

function structuredClone<T>(value: T): T {
  return v8.deserialize(v8.serialize(value)) as T;
}

describe("ThreadBoundaryError", () => {
  it("should clone RequestError through thread boundary", () => {
    const requestError = new RequestError({code: RequestErrorCode.TTFB_TIMEOUT});
    const threadBoundaryError = toThreadBoundaryError(requestError);
    const clonedError = structuredClone(threadBoundaryError);
    expect(clonedError.error).toBeNull();
    if (!clonedError.object) {
      // should not happen
      expect.fail("clonedError.object should not be null");
    }
    const clonedRequestError = fromThreadBoundaryError(clonedError);
    if (!(clonedRequestError instanceof RequestError)) {
      expect.fail("clonedRequestError should be instance of RequestError");
    }
    expect(clonedRequestError.toObject()).toEqual(requestError.toObject());
  });

  it("should clone ResponseError through thread boundary", () => {
    const responseError = new ResponseError(RespStatus.SERVER_ERROR, "internal server error");
    const threadBoundaryError = toThreadBoundaryError(responseError);
    const clonedError = structuredClone(threadBoundaryError);
    expect(clonedError.error).toBeNull();
    if (!clonedError.object) {
      // should not happen
      expect.fail("clonedError.object should not be null");
    }
    const clonedResponseError = fromThreadBoundaryError(clonedError);
    if (!(clonedResponseError instanceof ResponseError)) {
      expect.fail("clonedResponseError should be instance of ResponseError");
    }
    expect(clonedResponseError.toObject()).toEqual(responseError.toObject());
  });
});
