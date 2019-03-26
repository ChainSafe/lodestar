import { assert } from "chai";
import { loop } from "../utils";

describe("Loop", () => {
  const trueFn = async () => { return await setTimeout(() => {return true}, 2000) };

  it("Should return true", async () => {
    const res = await loop(trueFn, [], "","");
    assert.equal(res, true);
  })
})
