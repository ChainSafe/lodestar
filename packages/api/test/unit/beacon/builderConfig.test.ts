import {describe, expect, it} from "vitest";
import {BuilderEntryType} from "../../../src/beacon/routes/validator.js";

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
