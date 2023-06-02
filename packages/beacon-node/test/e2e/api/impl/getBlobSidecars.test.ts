import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {GENESIS_SLOT} from "@lodestar/params";

import {setupApiImplTestServer, ApiImplTestModules} from "../../../unit/api/impl/index.test.js";
import {zeroProtoBlock} from "../../../utils/mocks/chain.js";

describe("getBlobSideCar", function () {
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
  });

  // TODO: Write actual tests against the real BeaconChain class, this test is useless
  it.skip("getBlobSideCar From BlobSidecars", async () => {
    const block = config.getForkTypes(GENESIS_SLOT).SignedBeaconBlock.defaultValue();
    const blobSidecars = ssz.deneb.BlobSidecars.defaultValue();
    const wrappedBlobSidecars = {
      blockRoot: ssz.Root.defaultValue(),
      slot: block.message.slot,
      blobSidecars,
    };

    server.forkChoiceStub.getFinalizedBlock.returns(zeroProtoBlock);

    server.dbStub.blockArchive.get.resolves(block);
    server.dbStub.blobSidecars.get.resolves(wrappedBlobSidecars);

    const returnedBlobSideCars = await server.blockApi.getBlobSidecars("genesis");

    expect(returnedBlobSideCars.data).to.equal(blobSidecars);
  });
});
