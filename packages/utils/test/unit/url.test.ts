import {describe, expect, it} from "vitest";
import {toAsciiHttpUrl} from "../../src/url.js";

describe("toAsciiHttpUrl", () => {
  const testCases: {url: string; expected: string | null}[] = [
    {url: "https://platåberget.dev", expected: "https://xn--platberget-45a.dev/"},
    {url: "https://builder.example.com/é?x=1", expected: "https://builder.example.com/%C3%A9?x=1"},
    {url: "https://builder.example.com:8080/path", expected: "https://builder.example.com:8080/path"},
    {url: "ftp://builder.example.com", expected: null},
    {url: "builder.example.com", expected: null},
  ];

  for (const {url, expected} of testCases) {
    it(url, () => {
      expect(toAsciiHttpUrl(url)).toBe(expected);
    });
  }
});
