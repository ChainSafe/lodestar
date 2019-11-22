import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import {WinstonLogger} from "../../../../../src/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {handleIncomingAttestation} from "../../../../../src/network/gossip/handlers/attestation";

describe("gossip handlers - attestation", function () {

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
    const attestation = generateEmptyAttestation();
    handleMessageStub.returns(attestation);
    handleIncomingAttestation.bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTATION).calledOnce).to.be.true;
  });

  it("handle invalid message", function () {
    handleMessageStub.throws();
    handleIncomingAttestation.bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTATION).notCalled).to.be.true;
  });
    
});