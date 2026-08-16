import {describe, expect, it} from "vitest";
import {BuilderEntryType} from "../../../src/beacon/routes/validator.js";

describe("BuilderEntryType", () => {
  it("decodes an empty url so the beacon node can reject only that entry", () => {
    expect(BuilderEntryType.fields.url.fromJson("")).toEqual(new Uint8Array());
  });
});
