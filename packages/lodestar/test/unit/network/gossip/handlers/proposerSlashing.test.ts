import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/minimal";
import {generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {handleIncomingProposerSlashing} from "../../../../../src/network/gossip/handlers/proposerSlashing";
import {silentLogger} from "../../../../utils/logger";

describe("gossip handlers - proposerSlashing", function () {
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

  it("handle valid proposer slashing", async function () {
    const proposerSlashing = generateEmptyProposerSlashing();
    await handleIncomingProposerSlashing.bind(gossipStub)(proposerSlashing);

    expect(gossipStub.emit.withArgs(GossipEvent.PROPOSER_SLASHING, proposerSlashing).calledOnce).to.be.true;
  });
});
