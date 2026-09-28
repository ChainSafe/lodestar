import {describe, expect, it} from "vitest";
import {builderConfigDataFromJson} from "../../../src/keymanager/routes.js";

describe("builderConfigDataFromJson", () => {
  it("rejects invalid uint64 strings", () => {
    for (const value of ["00", "01", "-1", "1.0", "18446744073709551616"]) {
      expect(() => builderConfigDataFromJson({min_bid: value})).toThrow();
    }
  });

  it("rejects invalid builder urls", () => {
    for (const url of [
      "ftp://builder.example.com",
      "https://builder.example.com/é",
      "https://builder.example.com/\npath",
    ]) {
      expect(() => builderConfigDataFromJson({builders: [{url}]}), url).toThrow(
        "builders[0].url must be a valid HTTP or HTTPS URL using only ASCII characters"
      );
    }
  });

  it("suggests the ASCII form of a builder url with an internationalized hostname", () => {
    expect(() => builderConfigDataFromJson({builders: [{url: "https://platåberget.dev"}]})).toThrow(
      "use https://xn--platberget-45a.dev/ instead"
    );
  });
});
