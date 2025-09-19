import {describe, expect, it} from "vitest";
import {HttpClient} from "../../../src/index.js";

describe("HTTPClient options", () => {
  const baseUrl1 = "http://url-1";
  const baseUrl2 = "http://url-2";
  const bearerToken1 = "token-1";
  const bearerToken2 = "token-2";

  it("Single root baseUrl option", () => {
    const httpClient = new HttpClient({baseUrl: baseUrl1, globalInit: {bearerToken: bearerToken1}});

    const [urlInit] = httpClient["urlsInits"];

    expect(urlInit.baseUrl).toBe(baseUrl1);
    expect(urlInit.bearerToken).toBe(bearerToken1);
  });

  it("Multiple urls option with common bearerToken", () => {
    const httpClient = new HttpClient({
      urls: [baseUrl1, baseUrl2],
      globalInit: {
        bearerToken: bearerToken1,
      },
    });

    const [urlInit1, urlInit2] = httpClient["urlsInits"];

    expect(urlInit1.baseUrl).toBe(baseUrl1);
    expect(urlInit1.bearerToken).toBe(bearerToken1);
    expect(urlInit2.baseUrl).toBe(baseUrl2);
    expect(urlInit2.bearerToken).toBe(bearerToken1);
  });

  it("Multiple urls as object option", () => {
    const httpClient = new HttpClient({
      urls: [
        {baseUrl: baseUrl1, bearerToken: bearerToken1},
        {baseUrl: baseUrl2, bearerToken: bearerToken2},
      ],
    });

    const [urlInit1, urlInit2] = httpClient["urlsInits"];

    expect(urlInit1.baseUrl).toBe(baseUrl1);
    expect(urlInit1.bearerToken).toBe(bearerToken1);
    expect(urlInit2.baseUrl).toBe(baseUrl2);
    expect(urlInit2.bearerToken).toBe(bearerToken2);
  });

  it("baseUrl and urls option", () => {
    const httpClient = new HttpClient({
      baseUrl: baseUrl1,
      globalInit: {bearerToken: bearerToken1},
      urls: [{baseUrl: baseUrl2, bearerToken: bearerToken2}],
    });

    const [urlInit1, urlInit2] = httpClient["urlsInits"];

    expect(urlInit1.baseUrl).toBe(baseUrl1);
    expect(urlInit1.bearerToken).toBe(bearerToken1);
    expect(urlInit2.baseUrl).toBe(baseUrl2);
    expect(urlInit2.bearerToken).toBe(bearerToken2);
  });

  it("de-duplicate urls", () => {
    const httpClient = new HttpClient({
      baseUrl: baseUrl1,
      globalInit: {bearerToken: bearerToken1},
      urls: [
        {baseUrl: baseUrl2, bearerToken: bearerToken2},
        {baseUrl: baseUrl1, bearerToken: bearerToken1},
        {baseUrl: baseUrl2, bearerToken: bearerToken2},
      ],
    });

    const [urlInit1, urlInit2, urlInit3] = httpClient["urlsInits"];

    expect(urlInit1.baseUrl).toBe(baseUrl1);
    expect(urlInit1.bearerToken).toBe(bearerToken1);
    expect(urlInit2.baseUrl).toBe(baseUrl2);
    expect(urlInit2.bearerToken).toBe(bearerToken2);
    expect(urlInit3).toBeUndefined();
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
