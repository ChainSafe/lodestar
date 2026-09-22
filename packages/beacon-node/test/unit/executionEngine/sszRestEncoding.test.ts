import {describe, expect, it} from "vitest";
import {BitVectorType, ByteListType, ByteVectorType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {ForkName, MAX_BYTES_PER_TRANSACTION} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ExecutionPayloadStatus} from "../../../src/execution/engine/interface.js";
import {
  clForkToElFork,
  decodeBuiltPayload,
  decodeForkchoiceUpdateResponse,
  decodePayloadStatus,
  encodeForkchoiceUpdate,
  encodeNewPayload,
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

// Spec-derived oracle containers (refactor.md § Examples: every fork). Built here
// independently of the implementation so a field-order slip in the codec fails.
const Root = new ByteVectorType(32);
const ReqBytes = new ByteListType(MAX_BYTES_PER_TRANSACTION);
const ReqList = new ListCompositeType(ReqBytes, 256);

const EnvelopeParis = new ContainerType({payload: ssz.bellatrix.ExecutionPayload});
const EnvelopeCancun = new ContainerType({payload: ssz.deneb.ExecutionPayload, parentBeaconBlockRoot: Root});
const EnvelopePrague = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  parentBeaconBlockRoot: Root,
  executionRequests: ReqList,
});
const EnvelopeAmsterdam = new ContainerType({
  payload: ssz.gloas.ExecutionPayload,
  parentBeaconBlockRoot: Root,
  executionRequests: ReqList,
});

function payloadFor(fork: ForkName) {
  const p = ssz[fork as "bellatrix" | "capella" | "deneb" | "gloas"].ExecutionPayload.defaultValue();
  p.blockNumber = 7;
  return p;
}

describe("sszRestEncoding / ExecutionPayloadEnvelope", () => {
  it("paris: bare payload", () => {
    const bytes = encodeNewPayload(ForkName.bellatrix, payloadFor(ForkName.bellatrix));
    expect(EnvelopeParis.deserialize(bytes).payload.blockNumber).toBe(7);
  });

  it("cancun: payload + parent_beacon_block_root, no versioned hashes", () => {
    const root = new Uint8Array(32).fill(1);
    const bytes = encodeNewPayload(ForkName.deneb, payloadFor(ForkName.deneb), root);
    const parsed = EnvelopeCancun.deserialize(bytes);
    expect(parsed.parentBeaconBlockRoot).toEqual(root);
    expect(bytes.length).toBe(EnvelopeCancun.serialize(parsed).length);
  });

  it("prague/osaka: adds execution_requests as type-prefixed byte lists", () => {
    const root = new Uint8Array(32).fill(2);
    const deposit = ssz.electra.DepositRequest.defaultValue();
    for (const fork of [ForkName.electra, ForkName.fulu]) {
      const bytes = encodeNewPayload(fork, payloadFor(ForkName.deneb), root, {
        deposits: [deposit],
        withdrawals: [],
        consolidations: [],
      });
      const parsed = EnvelopePrague.deserialize(bytes);
      expect(parsed.executionRequests.length).toBe(1);
      expect(parsed.executionRequests[0][0]).toBe(0); // DEPOSIT_REQUEST_TYPE
    }
  });

  it("amsterdam: uses the gloas payload container", () => {
    const root = new Uint8Array(32).fill(3);
    const bytes = encodeNewPayload(ForkName.gloas, payloadFor(ForkName.gloas), root, {
      deposits: [],
      withdrawals: [],
      consolidations: [],
    });
    expect(EnvelopeAmsterdam.deserialize(bytes).payload.blockNumber).toBe(7);
  });

  it("requires parent root from cancun and execution requests from prague", () => {
    expect(() => encodeNewPayload(ForkName.deneb, payloadFor(ForkName.deneb))).toThrow(/parentBeaconBlockRoot/);
    expect(() => encodeNewPayload(ForkName.electra, payloadFor(ForkName.deneb), new Uint8Array(32))).toThrow(
      /executionRequests/
    );
  });
});

const FcState = new ContainerType({headBlockHash: Root, safeBlockHash: Root, finalizedBlockHash: Root});
const PaCancun = new ContainerType({
  timestamp: ssz.UintNum64,
  prevRandao: Root,
  suggestedFeeRecipient: new ByteVectorType(20),
  withdrawals: ssz.capella.Withdrawals,
  parentBeaconBlockRoot: Root,
});
const PaAmsterdam = new ContainerType({
  ...PaCancun.fields,
  slotNumber: ssz.UintNum64,
  targetGasLimit: ssz.UintNum64,
});
const FcuCancun = new ContainerType({forkchoiceState: FcState, payloadAttributes: new ListCompositeType(PaCancun, 1)});
const FcuAmsterdam = new ContainerType({
  forkchoiceState: FcState,
  payloadAttributes: new ListCompositeType(PaAmsterdam, 1),
  custodyColumns: new ListCompositeType(new BitVectorType(128), 1),
});

const zero32 = new Uint8Array(32);
const feeRecipient = `0x${"11".repeat(20)}`;

describe("sszRestEncoding / ForkchoiceUpdate", () => {
  it("cancun without attributes encodes payload_attributes as absent", () => {
    const bytes = encodeForkchoiceUpdate(ForkName.deneb, zero32, zero32, zero32);
    const parsed = FcuCancun.deserialize(bytes);
    expect(parsed.payloadAttributes.length).toBe(0);
    // fixed part: 96 (state) + 4 (offset) = 100; no attribute content follows
    expect(bytes.length).toBe(100);
  });

  it("cancun with attributes round-trips the fields", () => {
    const bytes = encodeForkchoiceUpdate(ForkName.deneb, zero32, zero32, zero32, {
      timestamp: 5,
      prevRandao: zero32,
      suggestedFeeRecipient: feeRecipient,
      withdrawals: [],
      parentBeaconBlockRoot: zero32,
    });
    const [attrs] = FcuCancun.deserialize(bytes).payloadAttributes;
    expect(attrs.timestamp).toBe(5);
    expect(attrs.suggestedFeeRecipient).toEqual(new Uint8Array(20).fill(0x11));
  });

  it("amsterdam carries custody_columns as an absent Optional and the v4 attributes", () => {
    const bytes = encodeForkchoiceUpdate(ForkName.gloas, zero32, zero32, zero32, {
      timestamp: 5,
      prevRandao: zero32,
      suggestedFeeRecipient: feeRecipient,
      withdrawals: [],
      parentBeaconBlockRoot: zero32,
      slotNumber: 9,
      targetGasLimit: 30_000_000,
    });
    const parsed = FcuAmsterdam.deserialize(bytes);
    expect(parsed.custodyColumns.length).toBe(0);
    expect(parsed.payloadAttributes[0].targetGasLimit).toBe(30_000_000);
    expect(parsed.payloadAttributes[0].slotNumber).toBe(9);
  });

  it("amsterdam without attributes is 4 bytes longer than cancun (extra offset for custody_columns)", () => {
    const cancun = encodeForkchoiceUpdate(ForkName.deneb, zero32, zero32, zero32);
    const amsterdam = encodeForkchoiceUpdate(ForkName.gloas, zero32, zero32, zero32);
    expect(amsterdam.length).toBe(cancun.length + 4);
  });

  it("requires fork-specific attribute fields", () => {
    const base = {timestamp: 1, prevRandao: zero32, suggestedFeeRecipient: feeRecipient, withdrawals: []};
    expect(() => encodeForkchoiceUpdate(ForkName.deneb, zero32, zero32, zero32, base)).toThrow(/parentBeaconBlockRoot/);
    expect(() =>
      encodeForkchoiceUpdate(ForkName.gloas, zero32, zero32, zero32, {...base, parentBeaconBlockRoot: zero32})
    ).toThrow(/slotNumber/);
  });
});

// refactor-ssz.md § BuiltPayload per fork — field order is normative:
// execution_requests precedes should_override_builder.
const BuiltParis = new ContainerType({payload: ssz.bellatrix.ExecutionPayload, blockValue: ssz.UintBn256});
const BuiltCancun = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  blockValue: ssz.UintBn256,
  blobsBundle: ssz.deneb.BlobsBundle,
  shouldOverrideBuilder: ssz.Boolean,
});
const BuiltPrague = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  blockValue: ssz.UintBn256,
  blobsBundle: ssz.deneb.BlobsBundle,
  executionRequests: ReqList,
  shouldOverrideBuilder: ssz.Boolean,
});
const BuiltOsaka = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  blockValue: ssz.UintBn256,
  blobsBundle: ssz.fulu.BlobsBundle,
  executionRequests: ReqList,
  shouldOverrideBuilder: ssz.Boolean,
});

describe("sszRestEncoding / BuiltPayload", () => {
  it("paris: {payload, block_value}", () => {
    const bytes = BuiltParis.serialize({payload: payloadFor(ForkName.bellatrix), blockValue: 42n});
    const d = decodeBuiltPayload(ForkName.bellatrix, bytes);
    expect(d.blockValue).toBe(42n);
    expect(d.executionPayload.blockNumber).toBe(7);
    expect(d.blobsBundle).toBeUndefined();
    expect(d.executionRequests).toBeUndefined();
    expect(d.shouldOverrideBuilder).toBeUndefined();
  });

  it("cancun: adds blobs_bundle V1 and should_override_builder", () => {
    const bundle = ssz.deneb.BlobsBundle.defaultValue();
    const bytes = BuiltCancun.serialize({
      payload: payloadFor(ForkName.deneb),
      blockValue: 1n,
      blobsBundle: bundle,
      shouldOverrideBuilder: true,
    });
    const d = decodeBuiltPayload(ForkName.deneb, bytes);
    expect(d.shouldOverrideBuilder).toBe(true);
    expect(d.blobsBundle).toEqual(bundle);
  });

  it("prague: execution_requests BEFORE should_override_builder", () => {
    const deposit = ssz.electra.DepositRequest.defaultValue();
    const depositBytes = ssz.electra.DepositRequests.serialize([deposit]);
    const req = new Uint8Array(1 + depositBytes.length);
    req[0] = 0;
    req.set(depositBytes, 1);
    const bytes = BuiltPrague.serialize({
      payload: payloadFor(ForkName.deneb),
      blockValue: 1n,
      blobsBundle: ssz.deneb.BlobsBundle.defaultValue(),
      executionRequests: [req],
      shouldOverrideBuilder: true,
    });
    const d = decodeBuiltPayload(ForkName.electra, bytes);
    expect(d.shouldOverrideBuilder).toBe(true);
    expect(d.executionRequests?.deposits.length).toBe(1);
  });

  it("osaka/amsterdam: blobs_bundle is the cell-proof V2 bundle", () => {
    const bundle = ssz.fulu.BlobsBundle.defaultValue();
    const bytes = BuiltOsaka.serialize({
      payload: payloadFor(ForkName.deneb),
      blockValue: 3n,
      blobsBundle: bundle,
      executionRequests: [],
      shouldOverrideBuilder: false,
    });
    const d = decodeBuiltPayload(ForkName.fulu, bytes);
    expect(d.blobsBundle).toEqual(bundle);
    expect(d.executionRequests).toEqual({deposits: [], withdrawals: [], consolidations: []});
  });
});
