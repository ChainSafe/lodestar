import {ssz} from "../../src";

describe("union", () => {
  it("struct hashTreeRoot", () => {
    const defaultValue = ssz.merge.ExecutionPayload.defaultValue();
    defaultValue.transactions.push(Buffer.alloc(512, 0));
    ssz.merge.ExecutionPayload.hashTreeRoot(defaultValue);
  });

  it("tree hashTreeRoot", () => {
    const defaultTreeBacked = ssz.merge.ExecutionPayload.defaultTreeBacked();
    defaultTreeBacked.transactions.push(Buffer.alloc(512, 0));
    ssz.merge.ExecutionPayload.hashTreeRoot(defaultTreeBacked);
  });
});
