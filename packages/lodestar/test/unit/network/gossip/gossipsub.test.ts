import {expect, assert} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import Libp2p from "libp2p";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {AbortController} from "@chainsafe/abort-controller";
import {config} from "@chainsafe/lodestar-config/default";
import {ForkName} from "@chainsafe/lodestar-params";
import {allForks, ssz} from "@chainsafe/lodestar-types";

import {Eth2Gossipsub, GossipHandlers, GossipType, GossipEncoding} from "../../../../src/network/gossip";
import {stringifyGossipTopic} from "../../../../src/network/gossip/topic";
import {ForkDigestContext} from "../../../../src/util/forkDigestContext";
import {encodeMessageData} from "../../../../src/network/gossip/encoding";
import {GossipValidationError} from "../../../../src/network/gossip/errors";

import {generateEmptySignedBlock} from "../../../utils/block";
import {createNode} from "../../../utils/network";
import {testLogger} from "../../../utils/logger";
import {GossipAction, GossipActionError} from "../../../../src/chain/errors";
import {generateState} from "../../../utils/state";
import {IBeaconChain, IBeaconClock} from "../../../../src/chain";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain";
import {TreeBacked} from "@chainsafe/ssz";

describe("network / gossip / validation", function () {
  const logger = testLogger();
  const metrics = null;
  const gossipType = GossipType.beacon_block;

  let message: InMessage;
  let topicString: string;
  let libp2p: Libp2p;
  let forkDigestContext: SinonStubbedInstance<ForkDigestContext>;
  let chain: IBeaconChain;

  let controller: AbortController;
  beforeEach(() => {
    controller = new AbortController();
    const state = generateState();
    chain = new MockBeaconChain({
      genesisTime: Math.floor(Date.now() / 1000),
      chainId: 0,
      networkId: BigInt(0),
      state: state as TreeBacked<allForks.BeaconState>,
      config,
    });
  });
  afterEach(() => controller.abort());

  beforeEach(async function () {
    forkDigestContext = sinon.createStubInstance(ForkDigestContext);
    forkDigestContext.forkName2ForkDigest.returns(Buffer.alloc(4, 1));
    forkDigestContext.forkDigest2ForkName.returns(ForkName.phase0);

    const signedBlock = generateEmptySignedBlock();
    topicString = stringifyGossipTopic(forkDigestContext, {type: gossipType, fork: ForkName.phase0});
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
        throw new GossipActionError(GossipAction.REJECT, {code: "TEST_ERROR"});
      },
    };

    const gossipSub = new Eth2Gossipsub({
      config,
      gossipHandlers: gossipHandlersPartial as GossipHandlers,
      logger,
      forkDigestContext,
      libp2p,
      metrics,
      signal: controller.signal,
      chain,
      clock: {} as IBeaconClock,
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
      forkDigestContext,
      libp2p,
      metrics,
      signal: controller.signal,
      chain,
      clock: {} as IBeaconClock,
    });

    await gossipSub.validate(message);
    // no error means pass validation
  });
});
