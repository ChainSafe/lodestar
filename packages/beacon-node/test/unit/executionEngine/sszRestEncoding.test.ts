import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {ExecutionPayloadStatus} from "../../../src/execution/engine/interface.js";
import {
  clForkToElFork,
  decodeForkchoiceUpdateResponse,
  decodePayloadStatus,
} from "../../../src/execution/engine/sszRestEncoding.js";

describe("sszRestEncoding / fork map", () => {
  it("maps every post-merge CL fork to its EL fork name", () => {
    expect(clForkToElFork(ForkName.bellatrix)).toBe("paris");
    expect(clForkToElFork(ForkName.capella)).toBe("shanghai");
    expect(clForkToElFork(ForkName.deneb)).toBe("cancun");
    expect(clForkToElFork(ForkName.electra)).toBe("prague");
    expect(clForkToElFork(ForkName.fulu)).toBe("osaka");
    expect(clForkToElFork(ForkName.gloas)).toBe("amsterdam");
  });

  it("throws for pre-merge forks", () => {
    expect(() => clForkToElFork(ForkName.phase0)).toThrow();
    expect(() => clForkToElFork(ForkName.altair)).toThrow();
  });
});

describe("sszRestEncoding / PayloadStatus", () => {
  // PayloadStatus {status: uint8, latest_valid_hash: Optional[Bytes32], validation_error: Optional[String]}
  // Fixed part: 1 (status) + 4 (offset) + 4 (offset) = 9 bytes.
  const FIXED = 9;

  it("decodes VALID with absent hash and absent error (9 bytes on the wire)", () => {
    const bytes = new Uint8Array([0, FIXED, 0, 0, 0, FIXED, 0, 0, 0]);
    expect(decodePayloadStatus(bytes)).toEqual({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: null,
      validationError: null,
    });
  });

  it("distinguishes absent validation_error from present-but-empty", () => {
    // Optional[String] present with "" = one element which is an empty ByteList:
    // outer list of one variable-size element = 4-byte offset (4) followed by zero bytes.
    const present = new Uint8Array([1, FIXED, 0, 0, 0, FIXED, 0, 0, 0, 4, 0, 0, 0]);
    expect(decodePayloadStatus(present).validationError).toBe("");
    const absent = new Uint8Array([1, FIXED, 0, 0, 0, FIXED, 0, 0, 0]);
    expect(decodePayloadStatus(absent).validationError).toBeNull();
  });

  it("decodes INVALID with hash and message", () => {
    const hash = new Uint8Array(32).fill(0xab);
    const msg = new TextEncoder().encode("bad block");
    // latest_valid_hash list content = 32 bytes at offset 9; validation_error at 9+32 = 41
    const bytes = new Uint8Array([1, FIXED, 0, 0, 0, FIXED + 32, 0, 0, 0, ...hash, 4, 0, 0, 0, ...msg]);
    expect(decodePayloadStatus(bytes)).toEqual({
      status: ExecutionPayloadStatus.INVALID,
      latestValidHash: `0x${"ab".repeat(32)}`,
      validationError: "bad block",
    });
  });

  it("maps status bytes 0..3 and rejects others", () => {
    const mk = (s: number): Uint8Array => new Uint8Array([s, FIXED, 0, 0, 0, FIXED, 0, 0, 0]);
    expect(decodePayloadStatus(mk(2)).status).toBe(ExecutionPayloadStatus.SYNCING);
    expect(decodePayloadStatus(mk(3)).status).toBe(ExecutionPayloadStatus.ACCEPTED);
    expect(() => decodePayloadStatus(mk(4))).toThrow(/Unknown payload status/);
  });
});

describe("sszRestEncoding / ForkchoiceUpdateResponse", () => {
  it("decodes payload_id when present", () => {
    // ForkchoiceUpdateResponse {payload_status: PayloadStatus (variable), payload_id: Optional[Bytes8] (variable)}
    // Fixed part: 4 + 4 = 8. payload_status content (9 bytes) at 8; payload_id content at 17.
    const payloadStatus = [0, 9, 0, 0, 0, 9, 0, 0, 0];
    const payloadId = [1, 2, 3, 4, 5, 6, 7, 8];
    const bytes = new Uint8Array([8, 0, 0, 0, 17, 0, 0, 0, ...payloadStatus, ...payloadId]);
    expect(decodeForkchoiceUpdateResponse(bytes)).toEqual({
      payloadStatus: {status: ExecutionPayloadStatus.VALID, latestValidHash: null, validationError: null},
      payloadId: "0x0102030405060708",
    });
  });

  it("decodes payload_id as null when absent", () => {
    const bytes = new Uint8Array([8, 0, 0, 0, 17, 0, 0, 0, 2, 9, 0, 0, 0, 9, 0, 0, 0]);
    expect(decodeForkchoiceUpdateResponse(bytes).payloadId).toBeNull();
    expect(decodeForkchoiceUpdateResponse(bytes).payloadStatus.status).toBe(ExecutionPayloadStatus.SYNCING);
  });
});
