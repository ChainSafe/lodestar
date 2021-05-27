import {expect} from "chai";
import {EventType} from "../../../src/routes/events";
import {stringifyQuery} from "../../../src/client/utils/format";

describe("client / utils / format", () => {
  it("Should repeat topic query", () => {
    expect(stringifyQuery({topics: [EventType.finalizedCheckpoint]})).to.equal("topics=finalized_checkpoint");
  });
});
