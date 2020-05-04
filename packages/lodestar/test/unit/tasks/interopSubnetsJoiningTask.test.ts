import {SinonStubbedInstance} from "sinon";
import {INetwork, Libp2pNetwork} from "../../../src/network";
import {IGossip} from "../../../src/network/gossip/interface";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import sinon from "sinon";
import {IBeaconChain} from "../../../src/chain";
import {Gossip} from "../../../src/network/gossip/gossip";
import {InteropSubnetsJoiningTask} from "../../../src/tasks/tasks/interopSubnetsJoiningTask";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {generateState} from "../../utils/state";
import {BeaconState} from "@chainsafe/lodestar-types";

describe("interopSubnetsJoiningTask", () => {
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipStub: SinonStubbedInstance<IGossip>;
  let chain: IBeaconChain;
  const logger = new WinstonLogger();
  let task: InteropSubnetsJoiningTask;
  let state: BeaconState;

  beforeEach(async () => {
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    gossipStub = sinon.createStubInstance(Gossip);
    networkStub.gossip = gossipStub;
    state = generateState();
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: 0n,
      state,
      config
    });
    task = new InteropSubnetsJoiningTask(config, {
      network: networkStub,
      chain,
      logger,
    });
    await task.start();
  });

  afterEach(async () => {
    await task.stop();
  });


  it("should handle fork digest change", async () => {
    const oldForkDigest = chain.currentForkDigest;
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.equal(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    // fork digest changed due to current version changed
    state.fork.currentVersion = Buffer.from([100, 0, 0, 0]);
    expect(config.types.ForkDigest.equals(oldForkDigest, chain.currentForkDigest)).to.be.false;
    chain.emit("forkDigest", chain.currentForkDigest);
    const subscribed = new Promise((resolve) => {
      gossipStub.subscribeToAttestationSubnet.callsFake(() => {
        resolve();
      });
    });
    await subscribed;
    expect(gossipStub.unsubscribeFromAttestationSubnet.callCount).to.be.equal(config.params.RANDOM_SUBNETS_PER_VALIDATOR);
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.equal(2 * config.params.RANDOM_SUBNETS_PER_VALIDATOR);
  });
});