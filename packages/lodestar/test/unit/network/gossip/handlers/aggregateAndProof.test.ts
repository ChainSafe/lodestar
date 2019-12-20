import {describe, it, beforeEach, afterEach} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {getIncomingAggregateAndProofHandler} from "../../../../../src/network/gossip/handlers/aggregateAndProof";
import {AggregateAndProof} from "@chainsafe/eth2.0-types";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import {WinstonLogger} from "../../../../../src/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import { GossipMessageValidator } from "../../../../../src/network/gossip/validator";

describe("gossip handlers - aggregate and proof", function () {

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

  it("handle valid message", async function () {
    const aggregate: AggregateAndProof = {
      index: 0,
      selectionProof: Buffer.alloc(0),
      aggregate: generateEmptyAttestation()
    };
    handleMessageStub.returns(aggregate);
    validatorStub.isValidIncomingAggregateAndProof.resolves(true);
    await getIncomingAggregateAndProofHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.AGGREGATE_AND_PROOF).calledOnce).to.be.true;
  });

  it("handle invalid message", async function () {
    handleMessageStub.throws();
    await getIncomingAggregateAndProofHandler(validatorStub).bind(gossipStub)({data: Buffer.alloc(0)});
    expect(gossipStub.emit.withArgs(GossipEvent.AGGREGATE_AND_PROOF).notCalled).to.be.true;
  });
    
});