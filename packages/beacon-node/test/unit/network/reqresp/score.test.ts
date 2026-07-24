import {describe, expect, it} from "vitest";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {PeerAction} from "../../../../src/network/peers/score/index.js";
import {onOutgoingReqRespError} from "../../../../src/network/reqresp/score.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";

describe("beacon-node / network / reqresp / score / onOutgoingReqRespError", () => {
  const PROTOCOL_SELECTION_FAILED = "protocol selection failed";

  // Mirror how the real send path builds these errors (packages/reqresp/src/request/index.ts):
  // neither passes a `message`, so `e.message` renders to just the error code and any underlying
  // detail (e.g. "protocol selection failed") lives on the wrapped inner error `e.type.error`.
  const dialTimeout = (): RequestError => new RequestError({code: RequestErrorCode.DIAL_TIMEOUT});
  const dialError = (innerMessage: string): RequestError =>
    new RequestError({code: RequestErrorCode.DIAL_ERROR, error: new Error(innerMessage)});

  const testCases: {id: string; method: ReqRespMethod; error: RequestError; expected: PeerAction | null}[] = [
    // Ping/Status dial timeouts are dominated by transient network congestion, not misbehavior,
    // so they get the lenient HighToleranceError to avoid self-inflicted peer starvation. See #9562.
    {
      id: "Ping DIAL_TIMEOUT -> HighToleranceError",
      method: ReqRespMethod.Ping,
      error: dialTimeout(),
      expected: PeerAction.HighToleranceError,
    },
    {
      id: "Status DIAL_TIMEOUT -> HighToleranceError",
      method: ReqRespMethod.Status,
      error: dialTimeout(),
      expected: PeerAction.HighToleranceError,
    },
    {
      id: "Ping DIAL_ERROR (non protocol-selection) -> HighToleranceError",
      method: ReqRespMethod.Ping,
      error: dialError("dial failed"),
      expected: PeerAction.HighToleranceError,
    },
    {
      id: "Status DIAL_ERROR (non protocol-selection) -> HighToleranceError",
      method: ReqRespMethod.Status,
      error: dialError("dial failed"),
      expected: PeerAction.HighToleranceError,
    },
    // "protocol selection failed" is a real protocol incompatibility, not a transient timeout. It is
    // only detectable on the inner error (`e.message` is the bare code), and must keep the stronger
    // penalty (Fatal for Ping, Low otherwise) rather than falling into the lenient Ping/Status path.
    {
      id: "Ping DIAL_ERROR protocol-selection-failed -> Fatal",
      method: ReqRespMethod.Ping,
      error: dialError(PROTOCOL_SELECTION_FAILED),
      expected: PeerAction.Fatal,
    },
    {
      id: "Status DIAL_ERROR protocol-selection-failed -> LowToleranceError",
      method: ReqRespMethod.Status,
      error: dialError(PROTOCOL_SELECTION_FAILED),
      expected: PeerAction.LowToleranceError,
    },
    {
      id: "BeaconBlocksByRange DIAL_ERROR protocol-selection-failed -> LowToleranceError",
      method: ReqRespMethod.BeaconBlocksByRange,
      error: dialError(PROTOCOL_SELECTION_FAILED),
      expected: PeerAction.LowToleranceError,
    },
    // Non-liveness methods keep the stronger LowToleranceError penalty on dial timeouts;
    // the #9562 evidence only supports loosening Ping/Status.
    {
      id: "BeaconBlocksByRange DIAL_TIMEOUT -> LowToleranceError",
      method: ReqRespMethod.BeaconBlocksByRange,
      error: dialTimeout(),
      expected: PeerAction.LowToleranceError,
    },
    {
      id: "Metadata DIAL_TIMEOUT -> LowToleranceError",
      method: ReqRespMethod.Metadata,
      error: dialTimeout(),
      expected: PeerAction.LowToleranceError,
    },
  ];

  for (const {id, method, error, expected} of testCases) {
    it(id, () => {
      expect(onOutgoingReqRespError(error, method)).toBe(expected);
    });
  }
});
