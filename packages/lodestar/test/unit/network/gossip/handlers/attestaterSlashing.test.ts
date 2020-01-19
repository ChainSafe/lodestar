import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {GossipMessageValidator} from "../../../../../src/network/gossip/validator";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {generateEmptyAttesterSlashing} from "../../../../utils/slashings";
import { getIncomingAttesterSlashingHandler } from "../../../../../src/network/gossip/handlers/attesterSlashing";

describe("gossip handlers - attesterSlashing", function () {

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

  it("handle valid attester slashing", async function () {
    const attesterSlashing = generateEmptyAttesterSlashing();
    handleMessageStub.returns(attesterSlashing);
    validatorStub.isValidIncomingAttesterSlashing.resolves(true);
    await getIncomingAttesterSlashingHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTER_SLASHING).calledOnce).to.be.true;
  });

  it("handle invalid attester slashing", async function () {
    const attesterSlashing = generateEmptyAttesterSlashing();
    handleMessageStub.returns(attesterSlashing);
    validatorStub.isValidIncomingAttesterSlashing.resolves(false);
    await getIncomingAttesterSlashingHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTER_SLASHING).notCalled).to.be.true;
  });

  it("handle invalid gossip message", async function () {
    handleMessageStub.throws();
    await getIncomingAttesterSlashingHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTER_SLASHING).notCalled).to.be.true;
  });
    
});