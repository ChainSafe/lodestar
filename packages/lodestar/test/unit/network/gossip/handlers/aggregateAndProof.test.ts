import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {handleIncomingAggregateAndProof} from "../../../../../src/network/gossip/handlers/aggregateAndProof";
import {AggregateAndProof, SignedAggregateAndProof} from "@chainsafe/lodestar-types";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

describe("gossip handlers - aggregate and proof", function () {
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

  it("handle valid message", async function () {
    const aggregate: AggregateAndProof = {
      aggregatorIndex: 0,
      selectionProof: Buffer.alloc(0),
      aggregate: generateEmptyAttestation(),
    };
    const signedAggregate: SignedAggregateAndProof = {
      message: aggregate,
      signature: Buffer.alloc(96),
    };
    await handleIncomingAggregateAndProof.bind(gossipStub)(signedAggregate);
    expect(gossipStub.emit.withArgs(GossipEvent.AGGREGATE_AND_PROOF, signedAggregate).calledOnce).to.be.true;
  });
});
