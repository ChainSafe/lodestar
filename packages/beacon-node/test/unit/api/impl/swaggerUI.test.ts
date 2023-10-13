import {expect} from "chai";
import {getFavicon, getLogo} from "../../../../src/api/rest/swaggerUI.js";

describe("swaggerUI", () => {
  it("should find the favicon and logo", async () => {
    expect(await getFavicon()).to.not.be.undefined;
    expect(await getLogo()).to.not.be.undefined;
  });
});
