import {describe, expect, it} from "vitest";
import {parseBackoffSeconds} from "../../../src/request/errors.js";

describe("parseBackoffSeconds", () => {
  const testCases: {input: string; expected: number | undefined}[] = [
    // Grandine format
    {input: "wait 2.816488536s", expected: 2817},
    {input: "wait 30s", expected: 30_000},
    {input: "wait 0.5s", expected: 500},
    // "seconds" / "second" variants
    {input: "wait 10 seconds", expected: 10_000},
    {input: "wait 1 second", expected: 1000},
    {input: "please wait 5 sec before retrying", expected: 5000},
    // No parseable duration
    {input: "rate limited", expected: undefined},
    {input: "peer has been rate limited", expected: undefined},
    {input: "rate limited. there are already 2 active requests with the same protocol", expected: undefined},
    {input: "wait a moment", expected: undefined},
    // Edge cases
    {input: "wait 0s", expected: undefined},
  ];

  for (const {input, expected} of testCases) {
    it(`"${input}" => ${expected}`, () => {
      expect(parseBackoffSeconds(input)).toBe(expected);
    });
  }
});
