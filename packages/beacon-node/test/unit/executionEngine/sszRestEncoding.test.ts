import {describe, expect, it} from "vitest";
import {BitVectorType, ByteListType, ByteVectorType, ContainerType, ListCompositeType, type Type} from "@chainsafe/ssz";
import {ForkName, MAX_BYTES_PER_TRANSACTION} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ExecutionPayloadStatus} from "../../../src/execution/engine/interface.js";
import {
  clForkToElFork,
  decodeBlobsV1Response,
  decodeBlobsV2Response,
  decodeBodiesResponse,
  decodeBuiltPayload,
  decodeForkchoiceUpdateResponse,
  decodePayloadStatus,
  encodeBlobsRequest,
  encodeBodiesByHashRequest,
  encodeForkchoiceUpdate,
  encodeNewPayload,
  parseCapabilities,
  parseIdentity,
} from "../../../src/execution/engine/sszRestEncoding.js";
import {BLOB_AND_PROOF_V2_RPC_BYTES} from "../../../src/execution/engine/types.js";

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

const TxList = new ListCompositeType(new ByteListType(MAX_BYTES_PER_TRANSACTION), 1_048_576);
const BodyParis = new ContainerType({transactions: TxList});
const BodyShanghai = new ContainerType({transactions: TxList, withdrawals: ssz.capella.Withdrawals});
const BodyAmsterdam = new ContainerType({
  transactions: TxList,
  withdrawals: ssz.capella.Withdrawals,
  blockAccessList: new ByteListType(MAX_BYTES_PER_TRANSACTION),
});
const entry = <T extends ContainerType<Record<string, Type<unknown>>>>(body: T) =>
  new ContainerType({available: ssz.Boolean, body});
const response = <T extends ContainerType<Record<string, Type<unknown>>>>(e: T) =>
  new ContainerType({entries: new ListCompositeType(e, 32)});
const BodiesParis = response(entry(BodyParis));
const BodiesShanghai = response(entry(BodyShanghai));
const BodiesAmsterdam = response(entry(BodyAmsterdam));
const BodiesByHashReq = new ContainerType({blockHashes: new ListCompositeType(Root, 32)});

describe("sszRestEncoding / bodies", () => {
  it("encodes BodiesByHashRequest as a single-field container", () => {
    const h = new Uint8Array(32).fill(9);
    expect(BodiesByHashReq.deserialize(encodeBodiesByHashRequest([h, h])).blockHashes.length).toBe(2);
  });

  it("paris body has no withdrawals -> null", () => {
    const tx = new Uint8Array([1, 2, 3]);
    const bytes = BodiesParis.serialize({entries: [{available: true, body: {transactions: [tx]}}]});
    expect(decodeBodiesResponse(ForkName.bellatrix, bytes)).toEqual([{transactions: [tx], withdrawals: null}]);
  });

  it("available=false -> null regardless of body contents", () => {
    const bytes = BodiesShanghai.serialize({
      entries: [
        {available: false, body: {transactions: [], withdrawals: []}},
        {available: true, body: {transactions: [], withdrawals: []}},
      ],
    });
    const out = decodeBodiesResponse(ForkName.capella, bytes);
    expect(out[0]).toBeNull();
    expect(out[1]).toEqual({transactions: [], withdrawals: []});
  });

  it("amsterdam body decodes with block_access_list present on the wire", () => {
    const bytes = BodiesAmsterdam.serialize({
      entries: [{available: true, body: {transactions: [], withdrawals: [], blockAccessList: new Uint8Array([7])}}],
    });
    expect(decodeBodiesResponse(ForkName.gloas, bytes)).toEqual([{transactions: [], withdrawals: []}]);
  });

  it("truncated range response is returned as a shorter array", () => {
    const bytes = BodiesShanghai.serialize({entries: []});
    expect(decodeBodiesResponse(ForkName.deneb, bytes)).toEqual([]);
  });
});

const Bytes48T = new ByteVectorType(48);
const Blob = new ByteVectorType(131072);
const BlobsReq = new ContainerType({versionedHashes: new ListCompositeType(Root, 128)});
const BlobAndProofV1 = new ContainerType({blob: Blob, proof: Bytes48T});
const BlobAndProofV2 = new ContainerType({blob: Blob, proofs: new ListCompositeType(Bytes48T, 128)});
const BlobsV1Resp = response(new ContainerType({available: ssz.Boolean, contents: BlobAndProofV1}));
const BlobsV2Resp = response(new ContainerType({available: ssz.Boolean, contents: BlobAndProofV2}));

describe("sszRestEncoding / blobs", () => {
  it("encodes BlobsRequest", () => {
    const h = new Uint8Array(32).fill(5);
    expect(BlobsReq.deserialize(encodeBlobsRequest([h])).versionedHashes[0]).toEqual(h);
  });

  it("v1: available=false -> null at that index", () => {
    const blob = new Uint8Array(131072).fill(1);
    const proof = new Uint8Array(48).fill(2);
    const bytes = BlobsV1Resp.serialize({
      entries: [
        {available: true, contents: {blob, proof}},
        {available: false, contents: {blob: new Uint8Array(131072), proof: new Uint8Array(48)}},
      ],
    });
    const out = decodeBlobsV1Response(bytes);
    expect(out[0]).toEqual({blob, proof});
    expect(out[1]).toBeNull();
  });

  it("v2: returns contents; copies into caller buffers when provided", () => {
    const blob = new Uint8Array(131072).fill(3);
    const proofs = Array.from({length: 128}, (_, i) => new Uint8Array(48).fill(i));
    const bytes = BlobsV2Resp.serialize({entries: [{available: true, contents: {blob, proofs}}]});

    const plain = decodeBlobsV2Response(bytes);
    expect(plain[0].blob).toEqual(blob);
    expect(plain[0].proofs[127]).toEqual(proofs[127]);

    const buffer = new Uint8Array(BLOB_AND_PROOF_V2_RPC_BYTES);
    const [into] = decodeBlobsV2Response(bytes, [buffer]);
    expect(into.blob.buffer).toBe(buffer.buffer);
    expect(into.proofs[5].buffer).toBe(buffer.buffer);
    expect(buffer.subarray(0, 131072)).toEqual(blob);
    expect(buffer.subarray(131072 + 5 * 48, 131072 + 6 * 48)).toEqual(proofs[5]);
  });

  it("v2: rejects available=false entries and wrong buffer sizes", () => {
    const bytes = BlobsV2Resp.serialize({
      entries: [{available: false, contents: {blob: new Uint8Array(131072), proofs: []}}],
    });
    expect(() => decodeBlobsV2Response(bytes)).toThrow(/available=false/);
    const ok = BlobsV2Resp.serialize({
      entries: [
        {available: true, contents: {blob: new Uint8Array(131072), proofs: Array(128).fill(new Uint8Array(48))}},
      ],
    });
    expect(() => decodeBlobsV2Response(ok, [new Uint8Array(10)])).toThrow(/buffer/);
  });
});

describe("sszRestEncoding / JSON diagnostics", () => {
  const specExample = {
    supported_forks: ["paris", "shanghai", "cancun", "prague", "osaka", "amsterdam"],
    fork_scoped_endpoints: ["payloads", "forkchoice", "bodies"],
    independently_versioned: {blobs: ["v1", "v2", "v3", "v4"]},
    unscoped_endpoints: ["capabilities", "identity"],
    limits: {"bodies.max_count": 32, "blobs.max_versioned_hashes": 128, "payload.max_bytes": 67108864},
  };

  it("parses the spec example", () => {
    const caps = parseCapabilities(specExample);
    expect([...caps.supportedForks]).toEqual(specExample.supported_forks);
    expect([...caps.blobRevisions]).toEqual([1, 2, 3, 4]);
    expect(caps.limits).toEqual({bodiesMaxCount: 32, blobsMaxVersionedHashes: 128, payloadMaxBytes: 67108864});
  });

  it("ignores unknown forks and defaults missing limits / blobs", () => {
    const caps = parseCapabilities({supported_forks: ["cancun", "verkle"]});
    expect([...caps.supportedForks]).toEqual(["cancun"]);
    expect(caps.blobRevisions.size).toBe(0);
    expect(caps.limits).toEqual({bodiesMaxCount: 32, blobsMaxVersionedHashes: 128, payloadMaxBytes: 67108864});
  });

  it("clamps advertised limits to the spec MAX_* constants", () => {
    const caps = parseCapabilities({supported_forks: [], limits: {"bodies.max_count": 999}});
    expect(caps.limits.bodiesMaxCount).toBe(32);
  });

  it("rejects bodies without supported_forks", () => {
    expect(() => parseCapabilities({})).toThrow(/supported_forks/);
    expect(() => parseCapabilities(null)).toThrow();
    expect(() => parseCapabilities("nope")).toThrow();
  });

  it("parses identity as ClientVersion[]", () => {
    const v = [{code: "GE", name: "geth", version: "1.0", commit: "0x00000000"}];
    expect(parseIdentity(v)).toEqual(v);
    expect(() => parseIdentity({})).toThrow();
    expect(() => parseIdentity([{code: "GE"}])).toThrow();
  });
});
