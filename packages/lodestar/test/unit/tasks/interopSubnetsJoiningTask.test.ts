import {SinonStubbedInstance, SinonFakeTimers} from "sinon";
import {INetwork, Network} from "../../../src/network";
import {minimalConfig} from "@chainsafe/lodestar-config/minimal";
import sinon from "sinon";
import {ChainEvent, IBeaconChain} from "../../../src/chain";
import {Eth2Gossipsub} from "../../../src/network/gossip";
import {InteropSubnetsJoiningTask} from "../../../src/tasks/tasks/interopSubnetsJoiningTask";
import {testLogger} from "../../utils/logger";
import {expect} from "chai";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {generateState} from "../../utils/state";
import {phase0} from "@chainsafe/lodestar-types";
import {MetadataController} from "../../../src/network/metadata";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {TreeBacked} from "@chainsafe/ssz";

describe("interopSubnetsJoiningTask", () => {
  const sandbox = sinon.createSandbox();
  let clock: SinonFakeTimers;
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub>;

  let chain: IBeaconChain;
  const logger = testLogger();
  let task: InteropSubnetsJoiningTask;
  let state: phase0.BeaconState;

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const params = Object.assign({}, minimalConfig.params);
  const config: IBeaconConfig = Object.assign({}, minimalConfig, {params});

  beforeEach(() => {
    clock = sandbox.useFakeTimers();
    networkStub = sandbox.createStubInstance(Network);
    gossipStub = sandbox.createStubInstance(Eth2Gossipsub);
    networkStub.gossip = (gossipStub as unknown) as Eth2Gossipsub;
    state = generateState();
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: BigInt(0),
      state: state as TreeBacked<phase0.BeaconState>,
      config,
    });
    networkStub.metadata = new MetadataController({}, {config, chain, logger});
    task = new InteropSubnetsJoiningTask(config, {
      network: networkStub,
      chain,
      logger,
    });
    task.start();
  });

  afterEach(() => {
    task.stop();
    sandbox.reset();
    clock.restore();
  });

  it("should handle fork digest change", async () => {
    const oldForkDigest = chain.getForkDigest();
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    // fork digest changed due to current version changed
    state.fork.currentVersion = config.getForkInfoRecord().lightclient.version;
    expect(config.types.ForkDigest.equals(oldForkDigest, chain.getForkDigest())).to.be.false;
    // not subscribe, just unsubscribe at that time
    const unSubscribePromise = new Promise((resolve) => gossipStub.unsubscribeTopic.callsFake(resolve));
    chain.emitter.emit(ChainEvent.forkVersion, state.fork.currentVersion, "phase0");
    await unSubscribePromise;
    expect(gossipStub.unsubscribeTopic.callCount).to.be.equal(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
  });

  it("should change subnet subscription after 2*EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION", async () => {
    const seqNumber = networkStub.metadata.seqNumber;
    expect(Number(seqNumber)).to.be.gt(0);
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    const unsubscribePromise = new Promise((resolve) => gossipStub.unsubscribeTopic.callsFake(resolve));
    clock.tick(
      2 *
        config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION *
        config.params.SLOTS_PER_EPOCH *
        config.params.SECONDS_PER_SLOT *
        1000
    );
    await unsubscribePromise;
    expect(gossipStub.unsubscribeTopic.callCount).to.be.gte(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    expect(gossipStub.subscribeTopic.callCount).to.be.gte(2 * config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    expect(Number(networkStub.metadata.seqNumber)).to.be.gt(Number(seqNumber));
  });
});
