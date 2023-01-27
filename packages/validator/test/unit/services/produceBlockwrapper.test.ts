import {expect} from "chai";
import sinon from "sinon";
import {createIChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {BlockProposingService} from "../../../src/services/block.js";
import {ValidatorStore, BuilderSelection} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";

describe("Produce Block with BuilderSelection", function () {
  const sandbox = sinon.createSandbox();
  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;

  const config = createIChainForkConfig(mainnetConfig);

  const clock = new ClockMock();
  const blockService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, null);
  const produceBlockWrapper = blockService["produceBlockWrapper"];

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("1. BuilderSelection = MaxProfit -  BlindedBlock blockValue > fullBlock blockValue - return blindedBlock ", async function () {
    const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

    api.validator.produceBlindedBlock.resolves({
      data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
      version: ForkName.bellatrix,
      blockValue: BigInt(1),
    });
    api.validator.produceBlock.resolves({data: fullBlock, blockValue: ssz.Wei.defaultValue()});
    api.validator.produceBlockV2.resolves({
      data: fullBlock,
      version: ForkName.bellatrix,
      blockValue: ssz.Wei.defaultValue(),
    });

    const produceBlockOpts = {
      strictFeeRecipientCheck: false,
      expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      isBuilderEnabled: true,
      builderSelection: BuilderSelection.MaxProfit,
    };
    const returnedBlock = await produceBlockWrapper(144897, signedBlock.body.randaoReveal, "", produceBlockOpts);
    expect(returnedBlock.data).to.deep.equal(signedBlock, "blindedBlock must be returned");
  });
  it("2. BuilderSelection = MaxProfit - fullBlock blockValue > BlindedBlock blockValue - return FullBlock", async function () {
    const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

    api.validator.produceBlindedBlock.resolves({
      data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
      version: ForkName.bellatrix,
      blockValue: ssz.Wei.defaultValue(),
    });
    api.validator.produceBlock.resolves({data: fullBlock, blockValue: BigInt(1)});
    api.validator.produceBlockV2.resolves({data: fullBlock, version: ForkName.bellatrix, blockValue: BigInt(1)});

    const produceBlockOpts = {
      strictFeeRecipientCheck: false,
      expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      isBuilderEnabled: true,
      builderSelection: BuilderSelection.MaxProfit,
    };
    const returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
    expect(returnedBlock.data).to.deep.equal(fullBlock, "fullBlock must be returned");
  });
  it("3. BuilderSelection = BuilderAlways - return BlindedBlock", async function () {
    const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

    api.validator.produceBlindedBlock.resolves({
      data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
      version: ForkName.bellatrix,
      blockValue: ssz.Wei.defaultValue(),
    });
    api.validator.produceBlock.resolves({data: fullBlock, blockValue: BigInt(1)});
    api.validator.produceBlockV2.resolves({data: fullBlock, version: ForkName.bellatrix, blockValue: BigInt(1)});

    const produceBlockOpts = {
      strictFeeRecipientCheck: false,
      expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      isBuilderEnabled: true,
      builderSelection: BuilderSelection.BuilderAlways,
    };
    const returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
    expect(returnedBlock.data).to.deep.equal(signedBlock, "blindedBlock must be returned");
  });
  it("4. fullBlock - null, BlindedBlock !=null return blindedBlock", async function () {
    const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
    //const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

    api.validator.produceBlindedBlock.resolves({
      data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
      version: ForkName.bellatrix,
      blockValue: ssz.Wei.defaultValue(),
    });
    api.validator.produceBlock.resolves();
    api.validator.produceBlockV2.resolves();

    let produceBlockOpts = {
      strictFeeRecipientCheck: false,
      expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      isBuilderEnabled: true,
      builderSelection: BuilderSelection.BuilderAlways,
    };
    let returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
    expect(returnedBlock.data).to.deep.equal(signedBlock, "blindedBlock must be returned");
    produceBlockOpts = {
      strictFeeRecipientCheck: false,
      expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      isBuilderEnabled: true,
      builderSelection: BuilderSelection.MaxProfit,
    };
    returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
    expect(returnedBlock.data).to.deep.equal(signedBlock, "blindedBlock must be returned");
  });
  it("5. fullBlock != null, BlindedBlock =null return fullBlock", async function () {
    const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

    api.validator.produceBlindedBlock.resolves();
    api.validator.produceBlock.resolves({data: fullBlock, blockValue: BigInt(1)});
    api.validator.produceBlockV2.resolves({data: fullBlock, version: ForkName.bellatrix, blockValue: BigInt(1)});

    let produceBlockOpts = {
      strictFeeRecipientCheck: false,
      expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      isBuilderEnabled: true,
      builderSelection: BuilderSelection.BuilderAlways,
    };
    let returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
    expect(returnedBlock.data).to.deep.equal(fullBlock, "fullBlock must be returned");
    produceBlockOpts = {
      strictFeeRecipientCheck: false,
      expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      isBuilderEnabled: true,
      builderSelection: BuilderSelection.MaxProfit,
    };
    returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
    expect(returnedBlock.data).to.deep.equal(fullBlock, "fullBlock must be returned");
  });
  it("6. !fullBlock, !BlindedBlock, throw error", async function () {
    const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();

    api.validator.produceBlindedBlock.resolves();
    api.validator.produceBlock.resolves();
    api.validator.produceBlockV2.resolves();

    const produceBlockOpts = {
      strictFeeRecipientCheck: false,
      expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      isBuilderEnabled: true,
      builderSelection: BuilderSelection.MaxProfit,
    };

    try {
      await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
    } catch (e) {
      expect(e).to.be.instanceOf(Error);
    }
  });
});
