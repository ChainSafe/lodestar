import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {handleIncomingAttestation} from "../../../../../src/network/gossip/handlers/attestation";

describe("gossip handlers - attestation", function () {

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

  it("handle valid attestation", async function () {
    const attestation = generateEmptyAttestation();
    await handleIncomingAttestation.bind(gossipStub)(attestation);
    expect(gossipStub.emit.withArgs(GossipEvent.ATTESTATION, attestation).calledOnce).to.be.true;
  });
    
});