import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {handleIncomingProposerSlashing} from "../../../../../src/network/gossip/handlers/proposerSlashing";

describe("gossip handlers - proposerSlashing", function () {

  const sandbox = sinon.createSandbox();

  let gossipStub: any;

  beforeEach(function () {
    gossipStub = sandbox.createStubInstance(Gossip);
    gossipStub.logger = sandbox.createStubInstance(WinstonLogger);
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