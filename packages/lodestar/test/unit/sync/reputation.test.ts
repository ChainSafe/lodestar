import sinon from "sinon";
import {expect} from  "chai";
import {IReputation, ReputationStore} from "../../../src/sync/IReputation";
import { AttestationSubnets } from "@chainsafe/lodestar-types";
import { config } from "@chainsafe/lodestar-config/lib/presets/mainnet";


describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let reps: ReputationStore;

  beforeEach(() => {
    reps = new ReputationStore();
  });

  afterEach(() => {
    sandbox.restore();
  });


  it("should able to add reputation", async function () {
    const expected: IReputation = {
      latestMetadata: null,
      latestStatus: null,
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

  it("should able to remove reputation", async function () {
    try {
      reps.add("lodestar");
      reps.remove("lodestar");
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should able to find by subnet", function() {
    const attnets: AttestationSubnets = config.types.AttestationSubnets.defaultValue();
    attnets[10] = true;
    const rep1 = reps.add("lodestar");
    rep1.latestMetadata = {attnets, seqNumber: 0n};
    const peerIds = reps.getPeerIdsBySubnet("10");
    expect(peerIds.length).to.be.equal(1);
    expect(peerIds[0]).to.be.equal("lodestar");
  });
});
