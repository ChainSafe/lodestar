import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "../../../../../src/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {generateEmptyBlock} from "../../../../utils/block";
import {handleIncomingBlock} from "../../../../../src/network/gossip/handlers/block";

describe("gossip handlers - block", function () {

  const sandbox = sinon.createSandbox();

  let handleMessageStub: any, gossipStub: any;

  beforeEach(function () {
    handleMessageStub = sandbox.stub(gossipUtils, "deserializeGossipMessage");
    gossipStub = sandbox.createStubInstance(Gossip);
    gossipStub.logger = sandbox.createStubInstance(WinstonLogger);
    gossipStub.config = config;
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("handle valid message", function () {
    const block = generateEmptyBlock();
    handleMessageStub.returns(block);
    handleIncomingBlock.bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.BLOCK).calledOnce).to.be.true;
  });

  it("handle invalid message", function () {
    handleMessageStub.throws();
    handleIncomingBlock.bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.BLOCK).notCalled).to.be.true;
  });
    
});