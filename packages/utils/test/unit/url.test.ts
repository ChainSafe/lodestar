import "../setup.js";
import {expect} from "chai";
import {toSafePrintableUrl} from "../../src/url.js";

describe("toSafePrintableUrl", () => {
  const testCases = [
    {input: "http://user:password@localhost", output: "http://localhost"},
    {input: "http://localhost?apikey=secret", output: "http://localhost"},
    {input: "http://@localhost", output: "http://localhost"},
    {input: "http://:password@localhost", output: "http://localhost"},
    {input: "http://user%3Apassword@localhost", output: "http://localhost"},
    {input: "http:user@localhost", output: "http://localhost"},
    {input: "http://#user:password@localhost", output: "http://localhost"},
    {input: "http/:/user:password@localhost", output: "http/:/localhost"},
    {input: "://user:password@localhost", output: "://localhost"},
    {input: "http/user:password@localhost", output: "localhost"},
    {input: "invalid url", output: "invalid url"},
  ];

  for (const {input, output} of testCases) {
    it(`should sanitize URL ${input}`, () => {
      expect(toSafePrintableUrl(input)).to.be.equal(output);
    });
  }
});
