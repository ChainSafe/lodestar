import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {GossipMessageValidator} from "../../../../../src/network/gossip/validator";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {generateEmptyBlock} from "../../../../utils/block";
import { getIncomingBlockHandler } from "../../../../../src/network/gossip/handlers/block";

describe("gossip handlers - block", function () {

  const sandbox = sinon.createSandbox();

  let handleMessageStub: any, gossipStub: any, validatorStub: any;

  beforeEach(function () {
    handleMessageStub = sandbox.stub(gossipUtils, "deserializeGossipMessage");
    validatorStub = sandbox.createStubInstance(GossipMessageValidator);
    gossipStub = sandbox.createStubInstance(Gossip);
    gossipStub.logger = sandbox.createStubInstance(WinstonLogger);
    gossipStub.config = config;
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("handle valid block", async function () {
    const block = generateEmptyBlock();
    handleMessageStub.returns(block);
    validatorStub.isValidIncomingBlock.resolves(true);
    await getIncomingBlockHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.BLOCK).calledOnce).to.be.true;
  });

  it("handle invalid block", async function () {
    const block = generateEmptyBlock();
    handleMessageStub.returns(block);
    validatorStub.isValidIncomingBlock.resolves(false);
    await getIncomingBlockHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.BLOCK).notCalled).to.be.true;
  });

  it("handle invalid message", async function () {
    handleMessageStub.throws();
    await getIncomingBlockHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.BLOCK).notCalled).to.be.true;
  });
    
});