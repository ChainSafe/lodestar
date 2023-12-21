import {describe, it, expect} from "vitest";
import {parseAcceptHeader} from "../../../src/utils/acceptHeader.js";
import {ResponseFormat} from "../../../src/interfaces.js";

describe("utils / acceptHeader", () => {
  describe("parseAcceptHeader", () => {
    const testCases: {header: string | undefined; expected: ResponseFormat}[] = [
      {header: undefined, expected: "json"},
      {header: "application/json", expected: "json"},
      {header: "application/octet-stream", expected: "ssz"},
      {header: "application/invalid", expected: "json"},
      {header: "application/invalid;q=1,application/octet-stream;q=0.1", expected: "ssz"},
      {header: "application/octet-stream;q=0.5,application/json;q=1", expected: "json"},
      {header: "application/octet-stream;q=1,application/json;q=0.1", expected: "ssz"},
      {header: "application/octet-stream,application/json;q=0.1", expected: "ssz"},
      {header: "application/octet-stream;,application/json;q=0.1", expected: "json"},
      {header: "application/octet-stream;q=2,application/json;q=0.1", expected: "json"},
      {header: "application/octet-stream;q=invalid,application/json;q=0.1", expected: "json"},
      {header: "application/octet-stream;q=invalid,application/json;q=0.1", expected: "json"},
      {header: "application/octet-stream  ; q=0.5 , application/json ; q=1", expected: "json"},
      {header: "application/octet-stream  ; q=1 , application/json ; q=0.1", expected: "ssz"},
      {header: "application/octet-stream;q=1,application/json;q=0.1", expected: "ssz"},

      // The implementation is order dependent, however, RFC-9110 doesn't specify a preference.
      // The following tests serve to document the behavior at the time of implementation- not a
      // specific requirement from the spec. In this case, last wins.
      {header: "application/octet-stream;q=1,application/json;q=1", expected: "json"},
      {header: "application/json;q=1,application/octet-stream;q=1", expected: "ssz"},
    ];

    it.each(testCases)("should correctly parse the header $header", ({header, expected}) => {
      expect(parseAcceptHeader(header)).toBe(expected);
    });
  });
});
