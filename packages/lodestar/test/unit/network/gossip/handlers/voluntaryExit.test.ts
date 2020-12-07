import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {generateEmptySignedVoluntaryExit} from "../../../../utils/voluntaryExits";
import {handleIncomingVoluntaryExit} from "../../../../../src/network/gossip/handlers/voluntaryExit";
import {silentLogger} from "../../../../utils/logger";

describe("gossip handlers - voluntaryExit", function () {
  const sandbox = sinon.createSandbox();

  let gossipStub: any;

  beforeEach(function () {
    gossipStub = sandbox.createStubInstance(Gossip);
    gossipStub.logger = silentLogger;
    gossipStub.config = config;
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("handle valid voluntary exit", async function () {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    await handleIncomingVoluntaryExit.bind(gossipStub)(voluntaryExit);

    expect(gossipStub.emit.withArgs(GossipEvent.VOLUNTARY_EXIT, voluntaryExit).calledOnce).to.be.true;
  });
});
