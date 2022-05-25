import {expect} from "chai";
import {differenceHex} from "../../../src/util/difference.js";

describe("utils / differenceHex", () => {
  const root0 = Buffer.alloc(32, 0);
  const root1a = Buffer.alloc(32, 1);
  const root1b = Buffer.alloc(32, 1);
  const root2 = Buffer.alloc(32, 2);

  it("Return new hex items", () => {
    const additionalRoots = differenceHex([root0, root1a], [root1b, root2]);
    expect(additionalRoots).to.deep.equal([root2]);
  });

  it("Return no new hex items", () => {
    const additionalRoots = differenceHex([root0, root1a], [root1b]);
    expect(additionalRoots).to.deep.equal([]);
  });
});
