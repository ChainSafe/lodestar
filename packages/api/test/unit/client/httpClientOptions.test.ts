import {describe, it, expect} from "vitest";
import {HttpClient} from "../../../src/index.js";

describe("HTTPClient options", () => {
  const baseUrl1 = "http://url-1";
  const baseUrl2 = "http://url-2";
  const bearerToken1 = "token-1";
  const bearerToken2 = "token-2";

  it("Single root baseUrl option", () => {
    const httpClient = new HttpClient({baseUrl: baseUrl1, bearerToken: bearerToken1});

    expect(httpClient["urlsOpts"]).toEqual([{baseUrl: baseUrl1, bearerToken: bearerToken1}]);
  });

  it("Multiple urls option with common bearerToken", () => {
    const httpClient = new HttpClient({
      urls: [baseUrl1, baseUrl2],
      bearerToken: bearerToken1,
    });

    expect(httpClient["urlsOpts"]).toEqual([
      {baseUrl: baseUrl1, bearerToken: bearerToken1},
      {baseUrl: baseUrl2, bearerToken: bearerToken1},
    ]);
  });

  it("Multiple urls as object option", () => {
    const httpClient = new HttpClient({
      urls: [
        {baseUrl: baseUrl1, bearerToken: bearerToken1},
        {baseUrl: baseUrl2, bearerToken: bearerToken2},
      ],
    });

    expect(httpClient["urlsOpts"]).toEqual([
      {baseUrl: baseUrl1, bearerToken: bearerToken1},
      {baseUrl: baseUrl2, bearerToken: bearerToken2},
    ]);
  });

  it("baseUrl and urls option", () => {
    const httpClient = new HttpClient({
      baseUrl: baseUrl1,
      bearerToken: bearerToken1,
      urls: [{baseUrl: baseUrl2, bearerToken: bearerToken2}],
    });

    expect(httpClient["urlsOpts"]).toEqual([
      {baseUrl: baseUrl1, bearerToken: bearerToken1},
      {baseUrl: baseUrl2, bearerToken: bearerToken2},
    ]);
  });

  it("de-duplicate urls", () => {
    const httpClient = new HttpClient({
      baseUrl: baseUrl1,
      bearerToken: bearerToken1,
      urls: [
        {baseUrl: baseUrl2, bearerToken: bearerToken2},
        {baseUrl: baseUrl1, bearerToken: bearerToken1},
        {baseUrl: baseUrl2, bearerToken: bearerToken2},
      ],
    });
    expect(httpClient["urlsOpts"]).toEqual([
      {baseUrl: baseUrl1, bearerToken: bearerToken1},
      {baseUrl: baseUrl2, bearerToken: bearerToken2},
    ]);
  });

  it("Throw if empty baseUrl", () => {
    expect(() => new HttpClient({baseUrl: ""})).toThrow(Error);
  });

  it("Throw if invalid baseUrl", () => {
    expect(() => new HttpClient({baseUrl: "invalid"})).toThrow(Error);
  });

  it("Throw if empty value in urls option", () => {
    expect(() => new HttpClient({urls: [""]})).toThrow(Error);
  });

  it("Throw if invalid value in urls option", () => {
    expect(() => new HttpClient({urls: ["invalid"]})).toThrow(Error);
  });

  it("Throw if invalid username/password", () => {
    expect(() => new HttpClient({baseUrl: "http://hasa%:%can'tbedecoded@localhost"})).toThrow(Error);
  });
});
