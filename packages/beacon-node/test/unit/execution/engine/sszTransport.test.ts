import {describe, expect, it} from "vitest";
import {ByteListType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {decodeEngineSszResponse, encodeEngineSszRequest} from "../../../../src/execution/engine/sszTransport.js";

const payloadStatusV1Type = new ContainerType(
  {
    status: ssz.Uint8,
    latestValidHash: ssz.Bytes32,
    validationError: new ByteListType(1024),
  },
  {typeName: "PayloadStatusV1Test"}
);

const forkchoiceUpdatedResponseV1Type = new ContainerType(
  {
    payloadStatus: payloadStatusV1Type,
    payloadId: ssz.Bytes8,
  },
  {typeName: "ForkchoiceUpdatedResponseV1Test"}
);

const clientVersionV1Type = new ContainerType(
  {
    code: new ByteListType(2),
    name: new ByteListType(64),
    version: new ByteListType(64),
    commit: ssz.Bytes4,
  },
  {typeName: "ClientVersionV1Test"}
);

const getClientVersionV1ResponseType = new ContainerType(
  {
    versions: new ListCompositeType(clientVersionV1Type, 4),
  },
  {typeName: "GetClientVersionV1ResponseTest"}
);

describe("execution / engine / sszTransport", () => {
  it("encodes payload bodies by range request", () => {
    const bytes = encodeEngineSszRequest("engine_getPayloadBodiesByRangeV1", ["0x10", "0x02"]);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes?.length).toBeGreaterThan(0);
  });

  it("returns undefined for methods without SSZ request body", () => {
    const bytes = encodeEngineSszRequest("engine_getPayloadV3", ["0x0102030405060708"]);

    expect(bytes).toBeUndefined();
  });

  it("decodes payload status response", () => {
    const bytes = payloadStatusV1Type.serialize({
      status: 0,
      latestValidHash: new Uint8Array(32),
      validationError: new Uint8Array(),
    });

    const res = decodeEngineSszResponse("engine_newPayloadV3", 200, bytes);

    expect(res).toEqual({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: null,
      validationError: null,
    });
  });

  it("decodes forkchoice response payload id", () => {
    const bytes = forkchoiceUpdatedResponseV1Type.serialize({
      payloadStatus: {
        status: 0,
        latestValidHash: new Uint8Array(32),
        validationError: new Uint8Array(),
      },
      payloadId: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    });

    const res = decodeEngineSszResponse("engine_forkchoiceUpdatedV3", 200, bytes);

    expect(res.payloadStatus.status).toBe(ExecutionPayloadStatus.VALID);
    expect(res.payloadId).toBe("0x0102030405060708");
  });

  it("decodes 204 blobs-v2 response as null", () => {
    const res = decodeEngineSszResponse("engine_getBlobsV2", 204, new Uint8Array());

    expect(res).toBeNull();
  });

  it("decodes client version response", () => {
    const bytes = getClientVersionV1ResponseType.serialize({
      versions: [
        {
          code: new TextEncoder().encode("GE"),
          name: new TextEncoder().encode("geth"),
          version: new TextEncoder().encode("v1.2.3"),
          commit: Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]),
        },
      ],
    });

    const res = decodeEngineSszResponse("engine_getClientVersionV1", 200, bytes);

    expect(res).toEqual([
      {
        code: "GE",
        name: "geth",
        version: "v1.2.3",
        commit: "0xaabbccdd",
      },
    ]);
  });
});
