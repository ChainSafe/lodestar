import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {GossipMessageValidator} from "../../../../../src/network/gossip/validator";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {generateEmptyProposerSlashing} from "../../../../utils/slashings";
import { getIncomingProposerSlashingHandler } from "../../../../../src/network/gossip/handlers/proposerSlashing";

describe("gossip handlers - proposerSlashing", function () {

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

  it("handle valid proposer slashing", async function () {
    const proposerSlashing = generateEmptyProposerSlashing();
    handleMessageStub.returns(proposerSlashing);
    validatorStub.isValidIncomingProposerSlashing.resolves(true);
    await getIncomingProposerSlashingHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.PROPOSER_SLASHING).calledOnce).to.be.true;
  });

  it("handle invalid proposer slashing", async function () {
    const proposerSlashing = generateEmptyProposerSlashing();
    handleMessageStub.returns(proposerSlashing);
    validatorStub.isValidIncomingProposerSlashing.resolves(false);
    await getIncomingProposerSlashingHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.PROPOSER_SLASHING).notCalled).to.be.true;
  });

  it("handle invalid message", async function () {
    handleMessageStub.throws();
    await getIncomingProposerSlashingHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.PROPOSER_SLASHING).notCalled).to.be.true;
  });
    
});