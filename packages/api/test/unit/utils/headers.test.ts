import {describe, it, expect} from "vitest";
import {MediaType, SUPPORTED_MEDIA_TYPES, mergeHeaders, parseAcceptHeader} from "../../../src/utils/headers.js";

describe("utils / headers", () => {
  describe("parseAcceptHeader", () => {
    const testCases: {header: string | undefined; expected: MediaType | null}[] = [
      {header: undefined, expected: null},
      {header: "*/*", expected: null},
      {header: "application/json", expected: MediaType.json},
      {header: "application/octet-stream", expected: MediaType.ssz},
      {header: "application/invalid", expected: null},
      {header: "application/invalid;q=1,application/octet-stream;q=0.1", expected: MediaType.ssz},
      {header: "application/octet-stream;q=0.5,application/json;q=1", expected: MediaType.json},
      {header: "application/octet-stream;q=1,application/json;q=0.1", expected: MediaType.ssz},
      {header: "application/octet-stream,application/json;q=0.1", expected: MediaType.ssz},
      {header: "application/octet-stream;,application/json;q=0.1", expected: MediaType.json},
      {header: "application/octet-stream;q=2,application/json;q=0.1", expected: MediaType.json},
      {header: "application/octet-stream;q=invalid,application/json;q=0.1", expected: MediaType.json},
      {header: "application/octet-stream;q=invalid,application/json;q=0.1", expected: MediaType.json},
      {header: "application/octet-stream  ; q=0.5 , application/json ; q=1", expected: MediaType.json},
      {header: "application/octet-stream  ; q=1 , application/json ; q=0.1", expected: MediaType.ssz},
      {header: "application/octet-stream;q=1,application/json;q=0.1", expected: MediaType.ssz},

      // The implementation is order dependent, however, RFC-9110 doesn't specify a preference.
      // The following tests serve to document the behavior at the time of implementation- not a
      // specific requirement from the spec. In this case, last wins.
      {header: "application/octet-stream;q=1,application/json;q=1", expected: MediaType.json},
      {header: "application/json;q=1,application/octet-stream;q=1", expected: MediaType.ssz},
    ];

    it.each(testCases)("should correctly parse the header $header", ({header, expected}) => {
      expect(parseAcceptHeader(header, SUPPORTED_MEDIA_TYPES)).toBe(expected);
    });
  });

  describe("mergeHeaders", () => {
    const testCases: {id: string; input: (HeadersInit | undefined)[]; expected: Headers}[] = [
      {
        id: "empty headers",
        input: [{}, [], new Headers()],
        expected: new Headers(),
      },
      {
        id: "undefined headers",
        input: [undefined, undefined],
        expected: new Headers(),
      },
      {
        id: "different headers",
        input: [{a: "1"}, {b: "2"}],
        expected: new Headers({a: "1", b: "2"}),
      },
      {
        id: "override on single header",
        input: [{a: "1"}, {b: "2"}, {a: "3"}],
        expected: new Headers({a: "3", b: "2"}),
      },
      {
        id: "multiple overrides on same header",
        input: [{a: "1"}, {b: "2"}, {a: "3"}, {a: "4"}],
        expected: new Headers({a: "4", b: "2"}),
      },
      {
        id: "multiple overrides on different headers",
        input: [{a: "1"}, {b: "2"}, {b: "3"}, {a: "4"}, {c: "5"}],
        expected: new Headers({a: "4", b: "3", c: "5"}),
      },
      {
        id: "headers from array into plain object",
        input: [{a: "1"}, [["b", "2"]]],
        expected: new Headers({a: "1", b: "2"}),
      },
      {
        id: "headers from plain object into array",
        input: [[["a", "1"]], {b: "2"}],
        expected: new Headers({a: "1", b: "2"}),
      },
      {
        id: "headers from all input types",
        input: [[["a", "1"]], {b: "2"}, new Headers({c: "3"}), {d: "4"}],
        expected: new Headers({a: "1", b: "2", c: "3", d: "4"}),
      },
    ];

    for (const {id, input, expected} of testCases) {
      it(`should correctly merge ${id}`, () => {
        expect(mergeHeaders(...input)).toEqual(expected);
      });
    }
  });
});
