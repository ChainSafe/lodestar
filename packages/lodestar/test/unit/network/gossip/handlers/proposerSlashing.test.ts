import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "../../../../../src/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {handleIncomingProposerSlashing} from "../../../../../src/network/gossip/handlers/proposerSlashing";

describe("gossip handlers - proposerSlashing", function () {

  const sandbox = sinon.createSandbox();

  let handleMessageStub: any, gossipStub: any;

  beforeEach(function () {
    handleMessageStub = sandbox.stub(gossipUtils, "handleGossipMessage");
    gossipStub = sandbox.createStubInstance(Gossip);
    gossipStub.logger = sandbox.createStubInstance(WinstonLogger);
    gossipStub.config = config;
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("handle valid message", function () {
    const proposerSlashing = generateEmptyProposerSlashing();
    handleMessageStub.returns(proposerSlashing);
    handleIncomingProposerSlashing.bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.PROPOSER_SLASHING).calledOnce).to.be.true;
  });

  it("handle invalid message", function () {
    handleMessageStub.throws();
    handleIncomingProposerSlashing.bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.PROPOSER_SLASHING).notCalled).to.be.true;
  });
    
});