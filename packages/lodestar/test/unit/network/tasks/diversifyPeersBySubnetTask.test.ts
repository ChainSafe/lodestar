import sinon, {SinonStubbedInstance} from "sinon";
import {INetwork, IReqResp, Libp2pNetwork} from "../../../../src/network";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ReqResp} from "../../../../src/network/reqresp/reqResp";
import {DiversifyPeersBySubnetTask} from "../../../../src/network/tasks/diversifyPeersBySubnetTask";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import PeerId from "peer-id";
import {IPeerMetadataStore} from "../../../../src/network/peers/interface";
import {Libp2pPeerMetadataStore} from "../../../../src/network/peers/metastore";

describe("DiversifyPeersBySubnetTask", function () {
  let networkStub: SinonStubbedInstance<INetwork>;
  let reqRespStub: SinonStubbedInstance<IReqResp>;
  let peerMetadataStore: SinonStubbedInstance<IPeerMetadataStore>;
  let task: DiversifyPeersBySubnetTask;

  beforeEach(() => {
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    reqRespStub = sinon.createStubInstance(ReqResp);
    networkStub.reqResp = reqRespStub;
    peerMetadataStore = sinon.createStubInstance(Libp2pPeerMetadataStore);
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

    expect(networkStub.searchSubnetPeers.callCount).to.be.equal(64);
  });

  it("should not search subnets", async () => {
    const peerId = await PeerId.create();
    networkStub.getPeers.returns([{id: peerId} as LibP2p.Peer]);

    peerMetadataStore.getMetadata.withArgs(peerId).returns({
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
    peerMetadataStore.getMetadata.withArgs(peerId).returns({
      attnets: attNets,
      seqNumber: BigInt(1),
    });

    const attNets2 = Array(64).fill(false);
    attNets2[1] = true;
    attNets2[2] = true;
    peerMetadataStore.getMetadata.withArgs(peerId2).returns({
      attnets: attNets2,
      seqNumber: BigInt(1),
    });

    await task.handleSyncCompleted();
    await task.run();

    expect(networkStub.searchSubnetPeers.callCount).to.be.equal(61);
  });
});
