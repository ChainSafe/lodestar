import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {GossipMessageValidator} from "../../../../../src/network/gossip/validator";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import { getIncomingAttestationHandler } from "../../../../../src/network/gossip/handlers/attestation";

describe("gossip handlers - attestation", function () {

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

  it("handle valid attestation", async function () {
    const attestation = generateEmptyAttestation();
    handleMessageStub.returns(attestation);
    validatorStub.isValidIncomingUnaggregatedAttestation.resolves(true);
    await getIncomingAttestationHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTATION).calledOnce).to.be.true;
  });

  it("handle invalid attestation", async function () {
    const attestation = generateEmptyAttestation();
    handleMessageStub.returns(attestation);
    validatorStub.isValidIncomingUnaggregatedAttestation.resolves(false);
    await getIncomingAttestationHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTATION).notCalled).to.be.true;
  });

  it("handle invalid gossip message", async function () {
    handleMessageStub.throws();
    await getIncomingAttestationHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTATION).notCalled).to.be.true;
  });
    
});