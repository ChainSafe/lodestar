import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {GossipMessageValidator} from "../../../../../src/network/gossip/validator";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {generateEmptySignedVoluntaryExit} from "../../../../utils/voluntaryExits";
import { getIncomingVoluntaryExitHandler } from "../../../../../src/network/gossip/handlers/voluntaryExit";

describe("gossip handlers - voluntaryExit", function () {

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

  it("handle valid voluntary exit", async function () {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    handleMessageStub.returns(voluntaryExit);
    validatorStub.isValidIncomingVoluntaryExit.resolves(true);
    await getIncomingVoluntaryExitHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.VOLUNTARY_EXIT).calledOnce).to.be.true;

  });

  it("handle invalid voluntary exit", async function () {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    handleMessageStub.returns(voluntaryExit);
    validatorStub.isValidIncomingVoluntaryExit.resolves(false);
    await getIncomingVoluntaryExitHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.VOLUNTARY_EXIT).notCalled).to.be.true;
  });

  it("handle invalid message", async function () {
    handleMessageStub.throws();
    await getIncomingVoluntaryExitHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.VOLUNTARY_EXIT).notCalled).to.be.true;
  });
    
});
