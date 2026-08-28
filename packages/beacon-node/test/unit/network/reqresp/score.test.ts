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
    // Dial timeouts are dominated by transient network congestion, not misbehavior, so every method
    // gets the lenient HighToleranceError to avoid self-inflicted peer starvation. See #9562.
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
    // Sync methods are issued far more often than the liveness probes, so a single transient
    // produces most of its penalties here. They must be lenient too, otherwise a request loop
    // retrying at a high rate bans the whole peer set in seconds.
    {
      id: "BeaconBlocksByRange DIAL_TIMEOUT -> HighToleranceError",
      method: ReqRespMethod.BeaconBlocksByRange,
      error: dialTimeout(),
      expected: PeerAction.HighToleranceError,
    },
    {
      id: "ExecutionPayloadEnvelopesByRoot DIAL_TIMEOUT -> HighToleranceError",
      method: ReqRespMethod.ExecutionPayloadEnvelopesByRoot,
      error: dialTimeout(),
      expected: PeerAction.HighToleranceError,
    },
    {
      id: "Metadata DIAL_TIMEOUT -> HighToleranceError",
      method: ReqRespMethod.Metadata,
      error: dialTimeout(),
      expected: PeerAction.HighToleranceError,
    },
  ];

  for (const {id, method, error, expected} of testCases) {
    it(id, () => {
      expect(onOutgoingReqRespError(error, method)).toBe(expected);
    });
  }

  // Under Bun an aborted dial rejects with an abort `Event` instead of an `AbortError`, so the
  // inner error had no `message` and `e.type.error.message.includes(...)` threw a secondary
  // `TypeError` that escaped as an uncaught exception. `RequestError` now normalizes the inner
  // value, so scoring sees a real `Error` and returns a verdict instead of throwing. See #9900.
  it("scores a DIAL_ERROR whose inner value is not an Error", () => {
    const bunAbortEvent = {type: "abort", isTrusted: false, local: true} as unknown as Error;
    const error = new RequestError({code: RequestErrorCode.DIAL_ERROR, error: bunAbortEvent});

    expect(onOutgoingReqRespError(error, ReqRespMethod.Ping)).toBe(PeerAction.HighToleranceError);
  });
});
