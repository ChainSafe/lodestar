import v8 from "node:v8";
import {expect} from "chai";
import {RequestError, RequestErrorCode, RespStatus, ResponseError} from "@lodestar/reqresp";
import {fromThreadBoundaryError, toThreadBoundaryError} from "../../../src/util/error.js";
import {AttestationError, AttestationErrorCode} from "../../../src/chain/errors/attestationError.js";
import {GossipAction} from "../../../src/chain/errors/index.js";

function structuredClone<T>(value: T): T {
  return v8.deserialize(v8.serialize(value)) as T;
}

describe("ThreadBoundaryError", () => {
  it("should clone RequestError through thread boundary", () => {
    const requestError = new RequestError({code: RequestErrorCode.TTFB_TIMEOUT});
    const threadBoundaryError = toThreadBoundaryError(requestError);
    const clonedError = structuredClone(threadBoundaryError);
    expect(clonedError.error).to.be.null;
    if (!clonedError.object) {
      // should not happen
      expect.fail("clonedError.object should not be null");
    }
    const clonedRequestError = fromThreadBoundaryError(clonedError);
    if (!(clonedRequestError instanceof RequestError)) {
      expect.fail("clonedRequestError should be instance of RequestError");
    }
    expect((clonedRequestError as RequestError).toObject()).to.be.deep.equal(requestError.toObject());
  });

  it("should clone ResponseError through thread boundary", () => {
    const responseError = new ResponseError(RespStatus.SERVER_ERROR, "internal server error");
    const threadBoundaryError = toThreadBoundaryError(responseError);
    const clonedError = structuredClone(threadBoundaryError);
    expect(clonedError.error).to.be.null;
    if (!clonedError.object) {
      // should not happen
      expect.fail("clonedError.object should not be null");
    }
    const clonedResponseError = fromThreadBoundaryError(clonedError);
    if (!(clonedResponseError instanceof ResponseError)) {
      expect.fail("clonedResponseError should be instance of ResponseError");
    }
    expect((clonedResponseError as ResponseError).toObject()).to.be.deep.equal(responseError.toObject());
  });

  it("should not able to clone AttestationError through thread boundary", () => {
    const attestationError = new AttestationError(GossipAction.IGNORE, {code: AttestationErrorCode.BAD_TARGET_EPOCH});
    const threadBoundaryError = toThreadBoundaryError(attestationError);
    const clonedError = structuredClone(threadBoundaryError);
    expect(clonedError.error).to.be.not.null;
    if (!clonedError.error) {
      // should not happen
      expect.fail("clonedError.error should not be null");
    }
    expect(clonedError.object).to.be.null;
    const clonedAttestationError = fromThreadBoundaryError(clonedError);
    expect(clonedAttestationError instanceof AttestationError).to.be.false;
  });
});
