import sinon, {SinonStubbedInstance} from "sinon";
import {expect, assert} from "chai";
import Libp2p from "libp2p";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {AbortController} from "@chainsafe/abort-controller";
import {ForkName, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";

import {Eth2Gossipsub, GossipHandlers, GossipType, GossipEncoding} from "../../../../src/network/gossip";
import {stringifyGossipTopic} from "../../../../src/network/gossip/topic";
import {encodeMessageData} from "../../../../src/network/gossip/encoding";
import {GossipValidationError} from "../../../../src/network/gossip/errors";

import {config} from "../../../utils/config";
import {generateEmptySignedBlock} from "../../../utils/block";
import {createNode} from "../../../utils/network";
import {testLogger} from "../../../utils/logger";
import {GossipAction, GossipActionError} from "../../../../src/chain/errors";
import {Eth2Context} from "../../../../src/chain";
import {IPeerRpcScoreStore, PeerRpcScoreStore} from "../../../../src/network/peers/score";

describe("network / gossip / validation", function () {
  const logger = testLogger();
  const metrics = null;
  const gossipType = GossipType.beacon_block;
  const sandbox = sinon.createSandbox();

  let message: InMessage;
  let topicString: string;
  let libp2p: Libp2p;
  let eth2Context: Eth2Context;
  let peerRpcScoresStub: IPeerRpcScoreStore & SinonStubbedInstance<PeerRpcScoreStore>;

  let controller: AbortController;
  beforeEach(() => {
    peerRpcScoresStub = sandbox.createStubInstance(PeerRpcScoreStore) as IPeerRpcScoreStore &
      SinonStubbedInstance<PeerRpcScoreStore>;
    controller = new AbortController();
    eth2Context = {
      activeValidatorCount: 16,
      currentEpoch: 1000,
      currentSlot: 1000 * SLOTS_PER_EPOCH,
    };
  });

  afterEach(() => {
    controller.abort();
    sandbox.restore();
  });

  beforeEach(async function () {
    const signedBlock = generateEmptySignedBlock();
    topicString = stringifyGossipTopic(config, {type: gossipType, fork: ForkName.phase0});
    message = {
      data: encodeMessageData(GossipEncoding.ssz_snappy, ssz.phase0.SignedBeaconBlock.serialize(signedBlock)),
      receivedFrom: "0",
      topicIDs: [topicString],
    };

    const multiaddr = "/ip4/127.0.0.1/tcp/0";
    libp2p = await createNode(multiaddr);
  });

  it("should throw on failed validation", async () => {
    const gossipHandlersPartial: Partial<GossipHandlers> = {
      [gossipType]: async () => {
        throw new GossipActionError(GossipAction.REJECT, null, {code: "TEST_ERROR"});
      },
    };

    const gossipSub = new Eth2Gossipsub({
      config,
      gossipHandlers: gossipHandlersPartial as GossipHandlers,
      logger,
      libp2p,
      peerRpcScores: peerRpcScoresStub,
      metrics,
      signal: controller.signal,
      eth2Context,
    });

    try {
      await gossipSub.validate(message);
      assert.fail("Expect error here");
    } catch (e) {
      expect({
        message: (e as Error).message,
        code: (e as GossipValidationError).code,
      }).to.deep.equal({
        message: "TEST_ERROR",
        code: ERR_TOPIC_VALIDATOR_REJECT,
      });
    }
  });

  it("should not throw on successful validation", async () => {
    const gossipHandlersPartial: Partial<GossipHandlers> = {
      [gossipType]: async () => {
        //
      },
    };

    const gossipSub = new Eth2Gossipsub({
      config,
      gossipHandlers: gossipHandlersPartial as GossipHandlers,
      logger,
      libp2p,
      peerRpcScores: peerRpcScoresStub,
      metrics,
      signal: controller.signal,
      eth2Context,
    });

    await gossipSub.validate(message);
    // no error means pass validation
  });
});
