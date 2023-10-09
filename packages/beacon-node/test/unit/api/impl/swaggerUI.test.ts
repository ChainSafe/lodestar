import {describe, it, expect} from "vitest";
import {getFavicon, getLogo} from "../../../../src/api/rest/swaggerUI.js";

describe("swaggerUI", () => {
  it("should find the favicon and logo", async () => {
    expect(await getFavicon()).toBeDefined();
    expect(await getLogo()).toBeDefined();
  });
});
