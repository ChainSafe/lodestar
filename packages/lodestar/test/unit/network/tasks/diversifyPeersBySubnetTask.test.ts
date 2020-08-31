import {SinonStubbedInstance} from "sinon";
import {INetwork, Libp2pNetwork, IReqResp} from "../../../../src/network";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

import {ReqResp} from "../../../../src/network/reqResp";
import {ReputationStore} from "../../../../src/sync/IReputation";
import {DiversifyPeersBySubnetTask} from "../../../../src/network/tasks/diversifyPeersBySubnetTask";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import PeerId from "peer-id";

describe("DiversifyPeersBySubnetTask", function () {
  let networkStub: SinonStubbedInstance<INetwork>;
  let reqRespStub: SinonStubbedInstance<IReqResp>;
  let reps: ReputationStore;
  let task: DiversifyPeersBySubnetTask;
  beforeEach(() => {
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    reqRespStub = sinon.createStubInstance(ReqResp);
    networkStub.reqResp = reqRespStub;
    reps = new ReputationStore();
    task = new DiversifyPeersBySubnetTask(config, {
      logger: new WinstonLogger(),
      network: networkStub,
      reps,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should search all subnets, no peer", async () => {
    networkStub.getPeers.returns([]);
    await task.run();
    expect(networkStub.searchSubnetPeers.callCount).to.be.equal(64);
  });

  it("should not search subnets", async () => {
    const peerId = await PeerId.create();
    networkStub.getPeers.returns([{id: peerId} as LibP2p.Peer]);
    reps.getFromPeerId(peerId).latestMetadata = {
      attnets: Array(64).fill(true),
      seqNumber: BigInt(1),
    };
    expect(networkStub.searchSubnetPeers.called).to.be.false;
  });

  it("should search 61 subnets", async () => {
    const peerId = await PeerId.create();
    const peerId2 = await PeerId.create();
    networkStub.getPeers.returns([peerId, peerId2].map((peerId) => ({id: peerId} as LibP2p.Peer)));
    const attNets = Array(64).fill(false);
    attNets[0] = true;
    attNets[1] = true;
    reps.getFromPeerId(peerId).latestMetadata = {
      attnets: attNets,
      seqNumber: BigInt(1),
    };
    const attNets2 = Array(64).fill(false);
    attNets2[1] = true;
    attNets2[2] = true;
    reps.getFromPeerId(peerId2).latestMetadata = {
      attnets: attNets2,
      seqNumber: BigInt(1),
    };
    await task.run();
    expect(networkStub.searchSubnetPeers.callCount).to.be.equal(61);
  });
});
