import sinon from "sinon";
import {Gossip} from "../../../../../src/network/gossip/gossip";
import {expect} from "chai";
import {GossipEvent} from "../../../../../src/network/gossip/constants";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {handleIncomingBlock} from "../../../../../src/network/gossip/handlers/block";
import {silentLogger} from "../../../../utils/logger";

describe("gossip handlers - block", function () {
  const sandbox = sinon.createSandbox();

  let gossipStub: any;

  beforeEach(function () {
    gossipStub = sandbox.createStubInstance(Gossip);
    gossipStub.logger = silentLogger;
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
