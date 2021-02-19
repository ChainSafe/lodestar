import sinon, {SinonStubbedInstance} from "sinon";
import {INetwork, IReqResp, Libp2pNetwork} from "../../../../src/network";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ReqResp} from "../../../../src/network/reqresp/reqResp";
import {DiversifyPeersBySubnetTask} from "../../../../src/network/tasks/diversifyPeersBySubnetTask";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import PeerId from "peer-id";
import {getStubbedMetadataStore, StubbedIPeerMetadataStore} from "../../../utils/peer";

describe("DiversifyPeersBySubnetTask", function () {
  let networkStub: SinonStubbedInstance<INetwork>;
  let reqRespStub: SinonStubbedInstance<IReqResp>;
  let peerMetadataStore: StubbedIPeerMetadataStore;
  let task: DiversifyPeersBySubnetTask;

  beforeEach(() => {
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    reqRespStub = sinon.createStubInstance(ReqResp);
    networkStub.reqResp = reqRespStub;
    peerMetadataStore = getStubbedMetadataStore();
    networkStub.peerMetadata = peerMetadataStore;
    task = new DiversifyPeersBySubnetTask(config, {
      logger: new WinstonLogger(),
      network: networkStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should search all subnets, no peer", async () => {
    networkStub.getPeers.returns([]);
    await task.handleSyncCompleted();
    await task.run();
    const allSubnets = Array.from({length: 64}, (_, i) => String(i));
    expect(networkStub.searchSubnetPeers.calledOnceWithExactly(allSubnets)).to.be.true;
  });

  it("should not search subnets", async () => {
    const peerId = await PeerId.create();
    networkStub.getPeers.returns([{id: peerId} as LibP2p.Peer]);

    peerMetadataStore.metadata.get.withArgs(peerId).returns({
      attnets: Array(64).fill(true),
      seqNumber: BigInt(1),
    });

    expect(networkStub.searchSubnetPeers.called).to.be.false;
  });

  it("should search 61 subnets", async () => {
    const peerId = await PeerId.create();
    const peerId2 = await PeerId.create();
    networkStub.getPeers.returns([peerId, peerId2].map((peerId) => ({id: peerId} as LibP2p.Peer)));

    const attNets = Array(64).fill(false);
    attNets[0] = true;
    attNets[1] = true;
    peerMetadataStore.metadata.get.withArgs(peerId).returns({
      attnets: attNets,
      seqNumber: BigInt(1),
    });

    const attNets2 = Array(64).fill(false);
    attNets2[1] = true;
    attNets2[2] = true;
    peerMetadataStore.metadata.get.withArgs(peerId2).returns({
      attnets: attNets2,
      seqNumber: BigInt(1),
    });

    await task.handleSyncCompleted();
    await task.run();
    // subnet 0,1,2 are connected
    const missingSubnets = Array.from({length: 61}, (_, i) => String(i + 3));
    expect(networkStub.searchSubnetPeers.calledOnceWithExactly(missingSubnets)).to.be.true;
  });
});
