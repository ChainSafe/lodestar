import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {peerIdFromString} from "@libp2p/peer-id";
import {ssz} from "@lodestar/types";
import {createIBeaconConfig, createIChainForkConfig, defaultChainConfig} from "@lodestar/config";

import {doBeaconBlocksMaybeBlobsByRange, ReqRespBeaconNode} from "../../../src/network/reqresp/index.js";
import {BlockInputType} from "../../../src/chain/blocks/types.js";

describe("doBeaconBlocksMaybeBlobsByRange", function () {
  const sandbox = sinon.createSandbox();
  const reqResp = sandbox.createStubInstance(ReqRespBeaconNode) as SinonStubbedInstance<ReqRespBeaconNode> &
    ReqRespBeaconNode;
  const peerId = peerIdFromString("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");
  const block = ssz.eip4844.SignedBeaconBlock.defaultValue();
  const blobsSidecar = ssz.eip4844.BlobsSidecar.defaultValue();
  reqResp.beaconBlocksByRange.resolves([block]);
  reqResp.blobsSidecarsByRange.resolves([blobsSidecar]);

  /* eslint-disable @typescript-eslint/naming-convention */
  const chainConfig = createIChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    EIP4844_FORK_EPOCH: 0,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);

  it("should match correctly", async () => {
    const response = await doBeaconBlocksMaybeBlobsByRange(
      config,
      reqResp,
      peerId,
      ssz.phase0.BeaconBlocksByRangeRequest.defaultValue(),
      0
    );
    expect(response).to.be.deep.equal([{type: BlockInputType.postEIP4844, block, blobs: blobsSidecar}]);
  });
});
