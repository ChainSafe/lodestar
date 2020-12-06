import {generateEmptySignedBlock} from "../../../utils/block";
import {config} from "@chainsafe/lodestar-config/minimal";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {getGossipTopic} from "../../../../src/network/gossip/utils";
import {ExtendedValidatorResult, GossipEvent} from "../../../../src/network/gossip/constants";
import {IGossipMessageValidator} from "../../../../src/network/gossip/interface";
import sinon from "sinon";
import {LodestarGossipsub} from "../../../../src/network/gossip/gossipsub";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect, assert} from "chai";
import {Libp2p} from "libp2p-gossipsub/src/interfaces";
import {createNode} from "../../../utils/network";
import {GossipEncoding} from "../../../../src/network/gossip/encoding";
import {ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";

const forkValue = Buffer.alloc(4);

describe("gossipsub", function () {
  const sandbox = sinon.createSandbox();
  let validator: IGossipMessageValidator;
  let gossipSub: LodestarGossipsub;
  let message: InMessage;

  beforeEach(async function () {
    const signedBLock = generateEmptySignedBlock();
    message = {
      data: config.types.SignedBeaconBlock.serialize(signedBLock),
      from: "0",
      receivedFrom: "0",
      seqno: new Uint8Array(),
      topicIDs: [getGossipTopic(GossipEvent.BLOCK, forkValue, GossipEncoding.SSZ)],
      signature: undefined,
      key: undefined,
    };
    validator = {} as IGossipMessageValidator;
    const multiaddr = "/ip4/127.0.0.1/tcp/0";
    const libp2p = await createNode(multiaddr);
    gossipSub = new LodestarGossipsub(config, validator, new WinstonLogger(), (libp2p as unknown) as Libp2p, {});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should throw exception because of failed validation", async () => {
    validator.isValidIncomingBlock = () => Promise.resolve(ExtendedValidatorResult.reject);
    try {
      await gossipSub.libP2pTopicValidator(message.topicIDs[0], message);
      assert.fail("Expect error here");
    } catch (e) {
      expect(e.code).to.be.equal(ERR_TOPIC_VALIDATOR_REJECT);
    }
  });

  it("should return true if pass validator function", async () => {
    validator.isValidIncomingBlock = () => Promise.resolve(ExtendedValidatorResult.accept);
    await gossipSub.libP2pTopicValidator(message.topicIDs[0], message);
    // no error means pass validation
  });
});
