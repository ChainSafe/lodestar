import {expect} from "chai";
import {extractJwtHexSecret} from "../../../src/util/index.js";

describe("parseJwtHexSecret", () => {
  const testCases: {raw: string; parsed: string}[] = [
    {
      raw: "c58e5dddf552f9f35e24466cc0c3cc479f82b1d09626c4217ff28220629d306b",
      parsed: "0xc58e5dddf552f9f35e24466cc0c3cc479f82b1d09626c4217ff28220629d306b",
    },
    {
      raw: "0xc58e5dddf552f9f35e24466cc0c3cc479f82b1d09626c4217ff28220629d306b",
      parsed: "0xc58e5dddf552f9f35e24466cc0c3cc479f82b1d09626c4217ff28220629d306b",
    },
    {
      raw: "0Xc58e5dddf552f9f35e24466cc0c3cc479f82b1d09626c4217ff28220629d306b",
      parsed: "0xc58e5dddf552f9f35e24466cc0c3cc479f82b1d09626c4217ff28220629d306b",
    },
  ];
  for (const {raw, parsed} of testCases) {
    it(`parse ${raw}`, () => {
      expect(parsed).to.be.equal(extractJwtHexSecret(raw));
    });
  }
});

describe("invalid jwtHexSecret", () => {
  const testCases: {raw: string; error: string}[] = [
    {raw: "c58e5dddf552f9f35e24466cc0c3cc479f82b1d09626c4217ff28220629d306b23", error: "invalid length"},
    {raw: "X58e5dddf552f9f35e24466cc0c3cc479f82b1d09626c4217ff28220629d306b", error: "invalid hex"},
  ];
  for (const {raw, error} of testCases) {
    it(`should error on ${error}:  ${raw}`, () => {
      expect(() => extractJwtHexSecret(raw)).to.throw();
    });
  }
});
