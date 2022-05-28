import {expect} from "chai";
import {EventType} from "../../../src/routes/events.js";
import {stringifyQuery} from "../../../src/client/utils/format.js";

describe("client / utils / format", () => {
  it("Should repeat topic query", () => {
    expect(stringifyQuery({topics: [EventType.finalizedCheckpoint]})).to.equal("topics=finalized_checkpoint");
  });
});
