import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/minimal";
import {generateEmptySignedVoluntaryExit} from "../../../../utils/voluntaryExits";
import {handleIncomingVoluntaryExit} from "../../../../../src/network/gossip/handlers/voluntaryExit";
import {testLogger} from "../../../../utils/logger";

describe("gossip handlers - voluntaryExit", function () {
  const sandbox = sinon.createSandbox();

  let gossipStub: any;

  beforeEach(function () {
    gossipStub = sandbox.createStubInstance(Gossip);
    gossipStub.logger = testLogger();
    gossipStub.config = config;
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("handle valid voluntary exit", function () {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    handleIncomingVoluntaryExit.bind(gossipStub)(voluntaryExit);

    expect(gossipStub.emit.withArgs(GossipEvent.VOLUNTARY_EXIT, voluntaryExit).calledOnce).to.be.true;
  });
});
