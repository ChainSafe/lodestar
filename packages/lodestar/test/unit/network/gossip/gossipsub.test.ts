import {expect, assert} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import Libp2p from "libp2p";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {config} from "@chainsafe/lodestar-config/minimal";
import {ForkName} from "@chainsafe/lodestar-config";

import {
  Eth2Gossipsub,
  getGossipTopicString,
  GossipType,
  TopicValidatorFn,
  GossipValidationError,
  encodeMessageData,
  GossipEncoding,
  TopicValidatorFnMap,
} from "../../../../src/network/gossip";

import {generateEmptySignedBlock} from "../../../utils/block";
import {createNode} from "../../../utils/network";
import {testLogger} from "../../../utils/logger";
import {ForkDigestContext} from "../../../../src/util/forkDigestContext";

describe("gossipsub", function () {
  const logger = testLogger();
  const metrics = null;
  let validatorFns: TopicValidatorFnMap;
  let gossipSub: Eth2Gossipsub;
  let message: InMessage;
  let topicString: string;
  let libp2p: Libp2p;
  let forkDigestContext: SinonStubbedInstance<ForkDigestContext>;

  beforeEach(async function () {
    forkDigestContext = sinon.createStubInstance(ForkDigestContext);
    forkDigestContext.forkName2ForkDigest.returns(Buffer.alloc(4, 1));
    forkDigestContext.forkDigest2ForkName.returns(ForkName.phase0);

    const signedBlock = generateEmptySignedBlock();
    topicString = getGossipTopicString(forkDigestContext, {type: GossipType.beacon_block, fork: ForkName.phase0});
    message = {
      data: encodeMessageData(GossipEncoding.ssz_snappy, config.types.phase0.SignedBeaconBlock.serialize(signedBlock)),
      receivedFrom: "0",
      topicIDs: [topicString],
    };

    validatorFns = new Map<string, TopicValidatorFn>();
    const multiaddr = "/ip4/127.0.0.1/tcp/0";
    libp2p = await createNode(multiaddr);
  });

  it("should throw on failed validation", async () => {
    validatorFns.set(topicString, () => {
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    });
    gossipSub = new Eth2Gossipsub({config, validatorFns, logger, forkDigestContext, libp2p, metrics});

    try {
      await gossipSub.validate(message);
      assert.fail("Expect error here");
    } catch (e) {
      expect((e as GossipValidationError).code).to.be.equal(ERR_TOPIC_VALIDATOR_REJECT);
    }
  });

  it("should not throw on successful validation", async () => {
    gossipSub = new Eth2Gossipsub({config, validatorFns, logger, forkDigestContext, libp2p, metrics});
    await gossipSub.validate(message);
    // no error means pass validation
  });
});
