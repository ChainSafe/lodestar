import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {generateEmptyAttesterSlashing} from "../../../../utils/slashings";
import {handleIncomingAttesterSlashing} from "../../../../../src/network/gossip/handlers/attesterSlashing";
import {silentLogger} from "../../../../utils/logger";

describe("gossip handlers - attesterSlashing", function () {
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

  it("handle valid attester slashing", async function () {
    const attesterSlashing = generateEmptyAttesterSlashing();
    await handleIncomingAttesterSlashing.bind(gossipStub)(attesterSlashing);
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTER_SLASHING, attesterSlashing).calledOnce).to.be.true;
  });
});
