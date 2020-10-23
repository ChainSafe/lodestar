import {Gossip} from "../../../../src/network/gossip/gossip";
import {INetworkOptions} from "../../../../src/network/options";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import sinon from "sinon";
import {NodejsNode} from "../../../../src/network/nodejs";
import {ChainEvent, IBeaconChain} from "../../../../src/chain";
import {expect} from "chai";
import {GossipEvent} from "../../../../src/network/gossip/constants";
import {getGossipTopic} from "../../../../src/network/gossip/utils";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {IGossipMessageValidator, IGossipSub} from "../../../../src/network/gossip/interface";
import {MockGossipSub} from "../../../utils/mocks/gossipsub";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain";
import {generateState} from "../../../utils/state";
import {generateEmptySignedBlock} from "../../../utils/block";
import {GossipEncoding} from "../../../../src/network/gossip/encoding";
import {BeaconState} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {silentLogger} from "../../../utils/logger";
import {sleep} from "@chainsafe/lodestar-utils";

describe("Network Gossip", function () {
  let gossip: Gossip;
  const sandbox = sinon.createSandbox();
  let pubsub: IGossipSub;
  let chain: IBeaconChain;
  let state: BeaconState;

  beforeEach(async () => {
    const networkOpts: INetworkOptions = {
      maxPeers: 0,
      minPeers: 0,
      localMultiaddrs: [],
      bootMultiaddrs: [],
      rpcTimeout: 0,
      connectTimeout: 0,
      disconnectTimeout: 0,
    };
    const libp2p = sandbox.createStubInstance(NodejsNode);
    const logger = silentLogger;
    const validator = {} as IGossipMessageValidator;
    state = generateState();
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: BigInt(0),
      state: state as TreeBacked<BeaconState>,
      config,
    });
    pubsub = new MockGossipSub();
    gossip = new Gossip(networkOpts, {config, libp2p, logger, validator, chain, pubsub});
    await gossip.start();
  });

  afterEach(async () => {
    await gossip.stop();
    await chain.stop();
    sandbox.restore();
  });

  describe("subscribe/unsubscribe", () => {
    it("should subscribe to attestation subnet correctly", async () => {
      const spy = sandbox.spy();
      const anotherSpy = sandbox.spy();
      const forkDigest = await chain.getForkDigest();
      gossip.subscribeToAttestationSubnet(forkDigest, "1", spy);
      gossip.subscribeToAttestationSubnet(forkDigest, "1", anotherSpy);
      gossip.subscribeToAttestationSubnet(forkDigest, "2", spy);
      const attestation = generateEmptyAttestation();
      pubsub.emit(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkDigest,
          GossipEncoding.SSZ_SNAPPY,
          new Map([["subnet", "1"]])
        ),
        attestation
      );
      // should not emit to 2 different subnets
      expect(spy.callCount).to.be.equal(1);
      expect(anotherSpy.callCount).to.be.equal(1);
    });

    it("should unsubscribe to single subnet correctly", async () => {
      const spy = sandbox.spy();
      const forkDigest = await chain.getForkDigest();
      gossip.subscribeToAttestationSubnet(forkDigest, "1", spy);
      // should not unsubscribe wrong subnet
      gossip.unsubscribeFromAttestationSubnet(forkDigest, "1", spy);
      const attestation = generateEmptyAttestation();
      pubsub.emit(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkDigest,
          GossipEncoding.SSZ_SNAPPY,
          new Map([["subnet", "1"]])
        ),
        attestation
      );
      pubsub.emit(
        getGossipTopic(GossipEvent.ATTESTATION_SUBNET, forkDigest, GossipEncoding.SSZ, new Map([["subnet", "1"]])),
        attestation
      );
      expect(spy.callCount).to.be.equal(0);
    });

    it("should unsubscribe across subnets correctly", async () => {
      const spy = sandbox.spy();
      const forkDigest = await chain.getForkDigest();
      gossip.subscribeToAttestationSubnet(forkDigest, "1", spy);
      const spy2 = sandbox.spy();
      gossip.subscribeToAttestationSubnet(forkDigest, "2", spy2);
      // should not unsubscribe wrong subnet
      gossip.unsubscribeFromAttestationSubnet(forkDigest, "2", spy2);
      const attestation = generateEmptyAttestation();
      pubsub.emit(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkDigest,
          GossipEncoding.SSZ_SNAPPY,
          new Map([["subnet", "1"]])
        ),
        attestation
      );
      expect(spy.callCount).to.be.equal(1);
      expect(spy2.callCount).to.be.equal(0);
    });

    it("should subscribe/unsubscribe to block correctly", async () => {
      const spy = sandbox.spy();
      const anotherSpy = sandbox.spy();
      const forkDigest = await chain.getForkDigest();
      gossip.subscribeToBlock(forkDigest, spy);
      gossip.subscribeToBlock(forkDigest, anotherSpy);
      const block = generateEmptySignedBlock();
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, forkDigest), block);
      expect(spy.callCount).to.be.equal(1);
      expect(anotherSpy.callCount).to.be.equal(1);
      // unsubscribe spy
      gossip.unsubscribe(forkDigest, GossipEvent.BLOCK, spy, new Map());
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, forkDigest), block);
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, forkDigest, GossipEncoding.SSZ), block);
      // still 1
      expect(spy.callCount).to.be.equal(1);
      // 1 more time => 2
      expect(anotherSpy.callCount).to.be.equal(3);
    });

    it("should ignore unsubscribing strange listener", async () => {
      const spy = sandbox.spy();
      const strangeListener = sandbox.spy();
      const forkDigest = await chain.getForkDigest();
      gossip.subscribeToBlock(forkDigest, spy);
      const block = generateEmptySignedBlock();
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, forkDigest), block);
      expect(spy.callCount).to.be.equal(1);
      gossip.unsubscribe(forkDigest, GossipEvent.BLOCK, strangeListener, new Map());
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, forkDigest), block);
      expect(spy.callCount).to.be.equal(2);
    });

    // other topics are the same

    it("should handle fork version changed", async () => {
      // fork digest is changed after gossip started
      const oldForkDigest = await chain.getForkDigest();
      state.fork.currentVersion = Buffer.from([100, 0, 0, 0]);
      const forkDigest = await chain.getForkDigest();
      expect(config.types.ForkDigest.equals(forkDigest, oldForkDigest)).to.be.false;
      const received = new Promise((resolve) => {
        gossip.subscribeToBlock(forkDigest, resolve);
      });
      chain.emitter.emit(ChainEvent.forkVersion, state.fork.currentVersion);
      await sleep(1);
      const block = generateEmptySignedBlock();
      pubsub.emit(getGossipTopic(GossipEvent.BLOCK, forkDigest, GossipEncoding.SSZ_SNAPPY, new Map()), block);
      await received;
    });
  });
});
