import {describe, expect, it} from "vitest";
import {parseBuilderUrls} from "../../../src/util/proposerConfig.js";

describe("validator / parseBuilderUrls", () => {
  it("parses urls into builder entries with optional fragment auth data", () => {
    expect(
      parseBuilderUrls(["https://builder-a.example.com", "https://builder-b.example.com/path?x=1#0x0123"])
    ).toEqual([
      {url: "https://builder-a.example.com", authData: undefined},
      {url: "https://builder-b.example.com/path?x=1", authData: "0x0123"},
    ]);
  });

  it("allows the same url with distinct auth data", () => {
    expect(parseBuilderUrls(["https://builder.example.com#0x01", "https://builder.example.com#0x02"])).toHaveLength(2);
  });

  it("rejects duplicate entries, comparing an omitted auth data as derived from the url", () => {
    const url = "https://builder.example.com";
    const derived = `0x${Buffer.from(url).toString("hex")}`;
    expect(() => parseBuilderUrls([url, url])).toThrow(/Duplicate builder url/);
    expect(() => parseBuilderUrls([url, `${url}#${derived}`])).toThrow(/Duplicate builder url/);
  });

  it("rejects invalid urls and auth data", () => {
    expect(() => parseBuilderUrls(["builder.example.com"])).toThrow(/Invalid builder url/);
    expect(() => parseBuilderUrls(["https://builder.example.com#"])).toThrow(/auth data/);
    expect(() => parseBuilderUrls(["https://builder.example.com#0x"])).toThrow(/auth data/);
    expect(() => parseBuilderUrls(["https://builder.example.com#secret"])).toThrow(/auth data/);
    expect(() => parseBuilderUrls(["https://builder.example.com#0x123"])).toThrow(/auth data/);
  });
});
