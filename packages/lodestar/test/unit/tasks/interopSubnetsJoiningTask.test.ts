import {SinonStubbedInstance, SinonFakeTimers} from "sinon";
import {INetwork, Libp2pNetwork} from "../../../src/network";
import {IGossip} from "../../../src/network/gossip/interface";
import {config as minimalConfig} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon from "sinon";
import {IBeaconChain} from "../../../src/chain";
import {Gossip} from "../../../src/network/gossip/gossip";
import {InteropSubnetsJoiningTask} from "../../../src/tasks/tasks/interopSubnetsJoiningTask";
import {WinstonLogger, bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {generateState} from "../../utils/state";
import {BeaconState} from "@chainsafe/lodestar-types";
import {MetadataController} from "../../../src/network/metadata";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";

describe("interopSubnetsJoiningTask", () => {
  const sandbox = sinon.createSandbox();
  let clock: SinonFakeTimers;
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipStub: SinonStubbedInstance<IGossip>;

  let chain: IBeaconChain;
  const logger = new WinstonLogger();
  let task: InteropSubnetsJoiningTask;
  let state: BeaconState;

  const ALL_FORKS = [
    {
      currentVersion: 2,
      epoch: 1000,
      // GENESIS_FORK_VERSION is <Buffer 00 00 00 01> but previousVersion = 16777216 not 1 due to bytesToInt
      previousVersion: bytesToInt(minimalConfig.params.GENESIS_FORK_VERSION)
    },
  ];
  const params = Object.assign({}, minimalConfig.params, {ALL_FORKS});
  const config: IBeaconConfig = Object.assign({}, minimalConfig, {params});

  beforeEach(async function () {
    clock = sandbox.useFakeTimers();
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    gossipStub = sandbox.createStubInstance(Gossip);
    networkStub.gossip = gossipStub;
    state = generateState();
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId:BigInt(0),
      state: state as TreeBacked<BeaconState>,
      config
    });
    networkStub.metadata = new MetadataController({}, {config, chain, logger});
    task = new InteropSubnetsJoiningTask(config, {
      network: networkStub,
      chain,
      logger,
    });
    await task.start();
  });

  afterEach(async () => {
    await task.stop();
    sandbox.reset();
    clock.restore();
  });


  it("should handle fork digest change", async () => {
    const oldForkDigest = chain.currentForkDigest;
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.equal(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    // fork digest changed due to current version changed
    state.fork.currentVersion = Buffer.from([100, 0, 0, 0]);
    expect(config.types.ForkDigest.equals(oldForkDigest, chain.currentForkDigest)).to.be.false;
    // not subscribe, just unsubscribe at that time
    const unSubscribePromise = new Promise((resolve) => gossipStub.unsubscribeFromAttestationSubnet.callsFake(resolve));
    chain.emit("forkDigest", chain.currentForkDigest);
    await unSubscribePromise;
    expect(gossipStub.unsubscribeFromAttestationSubnet.callCount)
      .to.be.equal(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
  });

  it("should change subnet subscription after 2*EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION", async () => {
    const seqNumber = networkStub.metadata.seqNumber;
    expect(Number(seqNumber)).to.be.gt(0);
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.equal(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    const unsubscribePromise = new Promise((resolve) => gossipStub.unsubscribeFromAttestationSubnet.callsFake(resolve));
    clock.tick(2 * config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION
      * config.params.SLOTS_PER_EPOCH
      * config.params.SECONDS_PER_SLOT
      * 1000);
    await unsubscribePromise;
    expect(gossipStub.unsubscribeFromAttestationSubnet.callCount).to.be.gte(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.gte(2 * config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    expect(Number(networkStub.metadata.seqNumber)).to.be.gt(Number(seqNumber));
  });

  it("should prepare for a hard fork", async function () {
    // scheduleNextForkSubscription already get called after start
    const state = await chain.getHeadState();
    const nextForkDigest =
      computeForkDigest(config, intToBytes(ALL_FORKS[0].currentVersion, 4), state.genesisValidatorsRoot);
    const spy = sandbox.spy();
    gossipStub.subscribeToAttestationSubnet.callsFake(spy);
    clock.tick((ALL_FORKS[0].epoch - config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION + 1)
      * config.params.SLOTS_PER_EPOCH
      * config.params.SECONDS_PER_SLOT
      * 1000);
    // at least 1 run right after start, 1 run in scheduleNextForkSubscription
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.gte(2 * config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    // subscribe to next fork digest subnet
    const forkDigestArgs = spy.args.map((callTimeArgs) => callTimeArgs[0]);
    let callNextForkDigest = false;
    for (const forkDigest of forkDigestArgs) {
      if (config.types.ForkDigest.equals(forkDigest, nextForkDigest)) {
        callNextForkDigest = true;
      }
    }
    expect(callNextForkDigest).to.be.true;
  });
});
