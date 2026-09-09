import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {BuilderEntryType, Endpoints, getDefinitions} from "../../../src/beacon/routes/validator.js";
import {ApiResponse} from "../../../src/utils/client/response.js";
import {MetaHeader} from "../../../src/utils/metadata.js";

describe("BuilderEntryType", () => {
  it("decodes an empty url so the beacon node can reject only that entry", () => {
    expect(BuilderEntryType.fields.url.fromJson("")).toEqual(new Uint8Array());
  });

  it("enforces the SSZ url byte limit for JSON", () => {
    expect(() => BuilderEntryType.fields.url.fromJson("é".repeat(1025))).toThrow(
      "Builder url must not exceed 2048 bytes"
    );
  });
});

describe("produceBlockV4 metadata", () => {
  it("reads the builder url from a JSON response header", async () => {
    const builderUrl = "https://builder.example.com";
    const response = new ApiResponse<Endpoints["produceBlockV4"]>(
      {
        ...getDefinitions(config).produceBlockV4,
        operationId: "produceBlockV4",
        urlFormatter: () => "/eth/v4/validator/blocks/1",
      },
      JSON.stringify({
        version: "gloas",
        consensus_block_value: "1",
        execution_payload_value: "2",
        execution_payload_included: false,
      }),
      {headers: {"Content-Type": "application/json", [MetaHeader.BuilderUrl]: builderUrl}}
    );

    await response.rawBody();

    expect(response.meta().builderUrl).toBe(builderUrl);
  });
});
