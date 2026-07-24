import {describe, expect, it} from "vitest";
import {RequestError, RequestErrorCode, RequestErrorType} from "@lodestar/reqresp";
import {PeerAction} from "../../../../src/network/peers/score/index.js";
import {onOutgoingReqRespError} from "../../../../src/network/reqresp/score.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";

describe("beacon-node / network / reqresp / score / onOutgoingReqRespError", () => {
  const PROTOCOL_SELECTION_FAILED = "protocol selection failed";

  function requestError(type: RequestErrorType, message: string): RequestError {
    return new RequestError(type, message);
  }

  const testCases: {id: string; method: ReqRespMethod; error: RequestError; expected: PeerAction | null}[] = [
    // Ping/Status dial timeouts are dominated by transient network congestion, not misbehavior,
    // so they get the lenient HighToleranceError to avoid self-inflicted peer starvation. See #9562.
    {
      id: "Ping DIAL_TIMEOUT -> HighToleranceError",
      method: ReqRespMethod.Ping,
      error: requestError({code: RequestErrorCode.DIAL_TIMEOUT}, "dial timeout"),
      expected: PeerAction.HighToleranceError,
    },
    {
      id: "Status DIAL_TIMEOUT -> HighToleranceError",
      method: ReqRespMethod.Status,
      error: requestError({code: RequestErrorCode.DIAL_TIMEOUT}, "dial timeout"),
      expected: PeerAction.HighToleranceError,
    },
    {
      id: "Ping DIAL_ERROR -> HighToleranceError",
      method: ReqRespMethod.Ping,
      error: requestError({code: RequestErrorCode.DIAL_ERROR, error: new Error("dial error")}, "dial error"),
      expected: PeerAction.HighToleranceError,
    },
    {
      id: "Status DIAL_ERROR -> HighToleranceError",
      method: ReqRespMethod.Status,
      error: requestError({code: RequestErrorCode.DIAL_ERROR, error: new Error("dial error")}, "dial error"),
      expected: PeerAction.HighToleranceError,
    },
    // A "protocol selection failed" dial error is a real incompatibility rather than a transient
    // timeout, so the pre-existing penalties are preserved (Fatal for Ping, Low for others).
    {
      id: "Ping DIAL_ERROR protocol-selection-failed -> Fatal",
      method: ReqRespMethod.Ping,
      error: requestError(
        {code: RequestErrorCode.DIAL_ERROR, error: new Error(PROTOCOL_SELECTION_FAILED)},
        PROTOCOL_SELECTION_FAILED
      ),
      expected: PeerAction.Fatal,
    },
    {
      id: "Status DIAL_ERROR protocol-selection-failed -> LowToleranceError",
      method: ReqRespMethod.Status,
      error: requestError(
        {code: RequestErrorCode.DIAL_ERROR, error: new Error(PROTOCOL_SELECTION_FAILED)},
        PROTOCOL_SELECTION_FAILED
      ),
      expected: PeerAction.LowToleranceError,
    },
    // Non-liveness methods keep the stronger LowToleranceError penalty on dial timeouts;
    // the #9562 evidence only supports loosening Ping/Status.
    {
      id: "BeaconBlocksByRange DIAL_TIMEOUT -> LowToleranceError",
      method: ReqRespMethod.BeaconBlocksByRange,
      error: requestError({code: RequestErrorCode.DIAL_TIMEOUT}, "dial timeout"),
      expected: PeerAction.LowToleranceError,
    },
    {
      id: "Metadata DIAL_TIMEOUT -> LowToleranceError",
      method: ReqRespMethod.Metadata,
      error: requestError({code: RequestErrorCode.DIAL_TIMEOUT}, "dial timeout"),
      expected: PeerAction.LowToleranceError,
    },
  ];

  for (const {id, method, error, expected} of testCases) {
    it(id, () => {
      expect(onOutgoingReqRespError(error, method)).toBe(expected);
    });
  }
});
