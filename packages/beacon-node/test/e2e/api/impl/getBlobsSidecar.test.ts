import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {GENESIS_SLOT} from "@lodestar/params";

import {setupApiImplTestServer, ApiImplTestModules} from "../../../unit/api/impl/index.test.js";

describe("getBlobsSideCar", function () {
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
  });

  it("getBlobsSideCar", async () => {
    const block = config.getForkTypes(GENESIS_SLOT).SignedBeaconBlock.defaultValue();
    const blobsSidecar = ssz.deneb.BlobsSidecar.defaultValue();
    block.message.slot = GENESIS_SLOT;

    server.dbStub.blockArchive.get.resolves(block);
    blobsSidecar.beaconBlockRoot = config.getForkTypes(GENESIS_SLOT).BeaconBlock.hashTreeRoot(block.message);

    server.dbStub.blobsSidecar.get.resolves(blobsSidecar);
    //server.dbStub.blobsSidecarArchive.get.resolves(blobsSidecar);

    const returnedBlobSideCar = await server.blockApi.getBlobsSidecar("genesis");

    expect(returnedBlobSideCar.data).to.equal(blobsSidecar);
  });
});
