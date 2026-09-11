import {describe, expect, it} from "vitest";
import {RespStatus} from "../../../src/interface.js";
import {RequestError, RequestErrorCode, responseStatusErrorToRequestError} from "../../../src/request/errors.js";
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
        rateLimitedUntilMs: expect.any(Number),
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

describe("RequestError inner error normalization", () => {
  // Bun rejects an aborted dial with an abort `Event` rather than an `AbortError`, so the value
  // handed to `new RequestError()` has no `message`. Peer scoring reads `e.type.error.message`
  // directly, which threw a secondary `TypeError` and escaped as an uncaught exception (#9900).
  const bunAbortEvent = {type: "abort", isTrusted: false, local: true};

  for (const code of [RequestErrorCode.DIAL_ERROR, RequestErrorCode.REQUEST_ERROR] as const) {
    it(`${code} coerces a non-Error inner value into an Error`, () => {
      const {error} = new RequestError({code, error: bunAbortEvent as unknown as Error}).type as {error: Error};

      expect(error).toBeInstanceOf(Error);
      // Detail from the original value is kept so the cause stays greppable in logs
      expect(error.message).toBe("abort");
      expect(() => error.message.includes("protocol selection failed")).not.toThrow();
    });

    it(`${code} keeps a real Error untouched`, () => {
      const inner = new Error("protocol selection failed");

      expect((new RequestError({code, error: inner}).type as {error: Error}).error).toBe(inner);
    });
  }

  it("falls back to the stringified value when it carries no message or type", () => {
    const type = new RequestError({code: RequestErrorCode.DIAL_ERROR, error: null as unknown as Error}).type;

    expect((type as {error: Error}).error.message).toBe("null");
  });

  // Thread-boundary clones do not preserve `Error` instances, so the rebuilt type would otherwise
  // carry a plain object where `RequestErrorType` declares an `Error`.
  it("normalizes an inner error lost by fromObject deserialization", () => {
    const {error} = RequestError.fromObject({
      className: "RequestError",
      message: RequestErrorCode.DIAL_ERROR,
      stack: "",
      type: {code: RequestErrorCode.DIAL_ERROR, error: {}} as never,
    }).type as {error: Error};

    expect(error).toBeInstanceOf(Error);
  });

  it("leaves codes without an inner error alone", () => {
    expect(new RequestError({code: RequestErrorCode.DIAL_TIMEOUT}).type).toEqual({
      code: RequestErrorCode.DIAL_TIMEOUT,
    });
  });
});
