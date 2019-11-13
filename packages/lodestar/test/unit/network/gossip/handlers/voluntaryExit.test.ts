import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "../../../../../src/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {handleIncomingProposerSlashing} from "../../../../../src/network/gossip/handlers/proposerSlashing";
import {generateEmptyVoluntaryExit} from "../../../../utils/voluntaryExits";
import {handleIncomingVoluntaryExit} from "../../../../../src/network/gossip/handlers/voluntaryExit";

describe("gossip handlers - voluntaryExit", function () {

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
    const voluntaryExit = generateEmptyVoluntaryExit();
    handleMessageStub.returns(voluntaryExit);
    handleIncomingVoluntaryExit.bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.VOLUNTARY_EXIT).calledOnce).to.be.true;
  });

  it("handle invalid message", function () {
    handleMessageStub.throws();
    handleIncomingProposerSlashing.bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.VOLUNTARY_EXIT).notCalled).to.be.true;
  });
    
});