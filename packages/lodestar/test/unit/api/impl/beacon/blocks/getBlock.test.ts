import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";
import * as blockUtils from "../../../../../../src/api/impl/beacon/blocks/utils";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {ArrayDagLMDGHOST, BeaconChain, IBeaconChain, ILMDGHOST} from "../../../../../../src/chain";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {Libp2pNetwork} from "../../../../../../src/network";
import {BeaconSync} from "../../../../../../src/sync";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import {generateEmptySignedBlock} from "../../../../../utils/block";

use(chaiAsPromised);

describe("api - beacon - getBlock", function () {

  const sandbox = sinon.createSandbox();

  let blockApi: BeaconBlockApi;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
  let resolveBlockIdStub: SinonStub;

  beforeEach(function () {
    forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    dbStub = new StubbedBeaconDb(sinon, config);
    resolveBlockIdStub = sandbox.stub(blockUtils, "resolveBlockId");
    blockApi = new BeaconBlockApi({}, {
      chain: chainStub,
      config,
      db: dbStub,
      logger: sinon.createStubInstance(WinstonLogger),
      network: sinon.createStubInstance(Libp2pNetwork),
      sync: sinon.createStubInstance(BeaconSync)
    });
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("block not found", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, "1").resolves(null);
    const result = await blockApi.getBlock("1");
    expect(result).to.be.null;
  });

  it("invalid block id", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any,"abc").throwsException();
    await expect(blockApi.getBlock("abc")).to.eventually.be.rejected;
  });

  it("success for non finalized block", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any,"head").resolves(Buffer.alloc(1));
    dbStub.block.get.withArgs(Buffer.alloc(1)).resolves(generateEmptySignedBlock());
    const result = await blockApi.getBlock("head");
    expect(result).to.not.be.null;
    expect(() => config.types.SignedBeaconBlock.assertValidValue(result)).to.not.throw();
  });

  it.skip("success for finalized block", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any,"0").resolves(Buffer.alloc(1));
    const result = await blockApi.getBlock("0");
    expect(result).to.not.be.null;
  });


});
