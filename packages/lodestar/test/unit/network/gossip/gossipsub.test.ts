import {describe, it} from "mocha";
import {generateEmptySignedBlock} from "../../../utils/block";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Message} from "libp2p-gossipsub/src/message";
import {getGossipTopic} from "../../../../src/network/gossip/utils";
import {GossipEvent} from "../../../../src/network/gossip/constants";
import {IGossipMessageValidator} from "../../../../src/network/gossip/interface";
import sinon from "sinon";
import {LodestarGossipsub} from "../../../../src/network/gossip/gossipsub";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {expect} from "chai";
import {createPeerId} from "../../../../src/network";
import {compress} from "snappyjs";

const forkValue = Buffer.alloc(4);

describe("gossipsub", function() {
  const sandbox = sinon.createSandbox();
  let validator: IGossipMessageValidator;
  let gossipSub: LodestarGossipsub;
  let message: Message;

  beforeEach(async function () {
    const signedBLock = generateEmptySignedBlock();
    message = {
      data: compress(Buffer.from(config.types.SignedBeaconBlock.serialize(signedBLock))),
      from: Buffer.from("0"),
      seqno: Buffer.from("0"),
      topicIDs: [getGossipTopic(GossipEvent.BLOCK, forkValue)]
    };
    validator = {} as IGossipMessageValidator;
    const registrar = {
      handle: (): null => null,
      register: (): string => "",
      unregister: (): boolean => false,
    };
    const peerId = await createPeerId();
    gossipSub = new LodestarGossipsub(config, validator, new WinstonLogger(),
      peerId, registrar, {});
  });

  afterEach(function () {
    sandbox.restore();
  });


  it("should return false because of failed validation", async () => {
    validator.isValidIncomingBlock = (): Promise<boolean> => Promise.resolve(false);
    const result = await gossipSub.validate(message);
    expect(result).to.be.false;
  });

  it("should return true if pass validator function", async () => {
    validator.isValidIncomingBlock = (): Promise<boolean> => Promise.resolve(true);
    const result = await gossipSub.validate(message);
    expect(result).to.be.true;
  });

  it("should return false because of duplicate", async () => {
    validator.isValidIncomingBlock = (): Promise<boolean> => Promise.resolve(true);
    const result = await gossipSub.validate(message);
    expect(result).to.be.true;
    // receive again => duplicate
    expect(await gossipSub.validate(message)).to.be.false;
  });
});
