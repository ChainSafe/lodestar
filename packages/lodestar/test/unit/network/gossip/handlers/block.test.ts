import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {handleIncomingBlock} from "../../../../../src/network/gossip/handlers/block";

describe("gossip handlers - block", function () {

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

  it("handle valid block", async function () {
    const block = generateEmptySignedBlock();
    await handleIncomingBlock.bind(gossipStub)(block);
    expect(gossipStub.emit.withArgs(GossipEvent.BLOCK, block).calledOnce).to.be.true;
  });

});
