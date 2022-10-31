import {expect} from "chai";
import {HttpClient} from "../../../src/index.js";

describe("HTTPClient options", () => {
  const baseUrl1 = "http://url-1";
  const baseUrl2 = "http://url-2";
  const bearerToken1 = "token-1";
  const bearerToken2 = "token-2";

  it("Single root baseUrl option", () => {
    const httpClient = new HttpClient({baseUrl: baseUrl1, bearerToken: bearerToken1});

    expect(httpClient["urlsOpts"]).deep.equals([{baseUrl: baseUrl1, bearerToken: bearerToken1}]);
  });

  it("Multiple urls option with common bearerToken", () => {
    const httpClient = new HttpClient({
      urls: [baseUrl1, baseUrl2],
      bearerToken: bearerToken1,
    });

    expect(httpClient["urlsOpts"]).deep.equals([
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

    expect(httpClient["urlsOpts"]).deep.equals([
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

    expect(httpClient["urlsOpts"]).deep.equals([
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
    expect(httpClient["urlsOpts"]).deep.equals([
      {baseUrl: baseUrl1, bearerToken: bearerToken1},
      {baseUrl: baseUrl2, bearerToken: bearerToken2},
    ]);
  });
});
