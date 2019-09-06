import sinon from "sinon";
import {expect} from  "chai";
import {Reputation, ReputationStore} from "../../../src/sync/reputation";


describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let reps: ReputationStore;

  beforeEach(() => {
    reps = new ReputationStore();
  });

  afterEach(() => {
    sandbox.restore();
  });


  it('should able to add reputation', async function () {
    const expected: Reputation = {
      latestHello: null,
      score: 0,
    };
    try {
      const result = reps.add("lodestar");
      expect(result).to.be.deep.equal(expected);
      expect(reps.get("lodestar")).to.be.deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should able to remove reputation', async function () {
    const expected: Reputation = {
      latestHello: null,
      score: 0,
    };
    try {
      reps.add("lodestar");
      reps.remove("lodestar");
    }catch (e) {
      expect.fail(e.stack);
    }
  });
});
