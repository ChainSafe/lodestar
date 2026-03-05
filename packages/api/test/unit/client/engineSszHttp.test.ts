import {describe, expect, it} from "vitest";
import {
  ENGINE_SSZ_ACCEPT,
  ENGINE_SSZ_CONTENT_TYPE,
  buildEngineSszRequestInit,
  isEngineSszUnsupportedStatus,
} from "../../../src/utils/client/engineSszHttp.js";

describe("api / client / engineSszHttp", () => {
  it("builds POST SSZ request init with octet-stream headers", () => {
    const req = buildEngineSszRequestInit(
      {
        httpMethod: "POST",
        path: "/engine/v3/payloads",
        capability: "POST /engine/v3/payloads",
      },
      new Uint8Array([1, 2, 3])
    );

    expect(req.method).toBe("POST");
    expect(req.urlPath).toBe("/engine/v3/payloads");
    expect(req.headers["Content-Type"]).toBe(ENGINE_SSZ_CONTENT_TYPE);
    expect(req.headers.Accept).toBe(ENGINE_SSZ_ACCEPT);
    expect(req.body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("throws if GET request includes body", () => {
    expect(() =>
      buildEngineSszRequestInit(
        {
          httpMethod: "GET",
          path: "/engine/v5/payloads/0x01",
          capability: "GET /engine/v5/payloads/{payload_id}",
        },
        new Uint8Array([1])
      )
    ).toThrow("GET SSZ engine request must not include a body");
  });

  it("classifies unsupported SSZ statuses", () => {
    expect(isEngineSszUnsupportedStatus(404)).toBe(true);
    expect(isEngineSszUnsupportedStatus(415)).toBe(true);
    expect(isEngineSszUnsupportedStatus(501)).toBe(true);
    expect(isEngineSszUnsupportedStatus(500)).toBe(false);
  });
});
