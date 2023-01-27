import {expect} from "chai";
import sinon from "sinon";
import {createIChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {HttpStatusCode} from "@lodestar/api";

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

  const blindedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
  const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
  const randaoReveal = fullBlock.body.randaoReveal;

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  // Testcase: BuilderSelection, builderBlockValue, engineBlockValue, selection
  // null blockValue means the block was not produced
  const testCases: [BuilderSelection, number | null, number, string][] = [
    [BuilderSelection.MaxProfit, 1, 0, "builder"],
  ];
  testCases.forEach(([builderSelection, builderBlockValue, engineBlockValue, finalSelection]) => {
    it(`builder selection = ${builderSelection}, builder blockValue = ${builderBlockValue}, engine blockValue = ${engineBlockValue} - expected selection = ${finalSelection} `, async function () {
      if (builderBlockValue !== null) {
        api.validator.produceBlindedBlock.resolves({
          response: {
            data: blindedBlock,
            version: ForkName.bellatrix,
            blockValue: BigInt(builderBlockValue),
          },
          ok: true,
          status: HttpStatusCode.OK,
        });
      } else {
        api.validator.produceBlindedBlock.throws(Error("not produced"));
      }

      if (engineBlockValue !== null) {
        api.validator.produceBlock.resolves({
          response: {data: fullBlock, blockValue: BigInt(engineBlockValue)},
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.validator.produceBlockV2.resolves({
          response: {
            data: fullBlock,
            version: ForkName.bellatrix,
            blockValue: BigInt(engineBlockValue),
          },
          ok: true,
          status: HttpStatusCode.OK,
        });
      } else {
        api.validator.produceBlock.throws(Error("not produced"));
        api.validator.produceBlockV2.throws(Error("not produced"));
      }

      const produceBlockOpts = {
        strictFeeRecipientCheck: false,
        expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        isBuilderEnabled: true,
        builderSelection,
      };
      const {
        debugLogCtx: {source},
      } = ((await produceBlockWrapper(144897, randaoReveal, "", produceBlockOpts)) as unknown) as {
        debugLogCtx: {source: string};
      };
      expect(source).to.equal(finalSelection, "blindedBlock must be returned");
    });
  });

  // it("2. BuilderSelection = MaxProfit - fullBlock blockValue > BlindedBlock blockValue - return FullBlock", async function () {
  //   const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
  //   const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

  //   api.validator.produceBlindedBlock.resolves({
  //     data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
  //     version: ForkName.bellatrix,
  //     blockValue: ssz.Wei.defaultValue(),
  //   });
  //   api.validator.produceBlock.resolves({data: fullBlock, blockValue: BigInt(1)});
  //   api.validator.produceBlockV2.resolves({data: fullBlock, version: ForkName.bellatrix, blockValue: BigInt(1)});

  //   const produceBlockOpts = {
  //     strictFeeRecipientCheck: false,
  //     expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  //     isBuilderEnabled: true,
  //     builderSelection: BuilderSelection.MaxProfit,
  //   };
  //   const returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
  //   expect(returnedBlock.data).to.deep.equal(fullBlock, "fullBlock must be returned");
  // });
  // it("3. BuilderSelection = BuilderAlways - return BlindedBlock", async function () {
  //   const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
  //   const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

  //   api.validator.produceBlindedBlock.resolves({
  //     data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
  //     version: ForkName.bellatrix,
  //     blockValue: ssz.Wei.defaultValue(),
  //   });
  //   api.validator.produceBlock.resolves({data: fullBlock, blockValue: BigInt(1)});
  //   api.validator.produceBlockV2.resolves({data: fullBlock, version: ForkName.bellatrix, blockValue: BigInt(1)});

  //   const produceBlockOpts = {
  //     strictFeeRecipientCheck: false,
  //     expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  //     isBuilderEnabled: true,
  //     builderSelection: BuilderSelection.BuilderAlways,
  //   };
  //   const returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
  //   expect(returnedBlock.data).to.deep.equal(signedBlock, "blindedBlock must be returned");
  // });
  // it("4. fullBlock - null, BlindedBlock !=null return blindedBlock", async function () {
  //   const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
  //   //const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

  //   api.validator.produceBlindedBlock.resolves({
  //     data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
  //     version: ForkName.bellatrix,
  //     blockValue: ssz.Wei.defaultValue(),
  //   });
  //   api.validator.produceBlock.resolves();
  //   api.validator.produceBlockV2.resolves();

  //   let produceBlockOpts = {
  //     strictFeeRecipientCheck: false,
  //     expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  //     isBuilderEnabled: true,
  //     builderSelection: BuilderSelection.BuilderAlways,
  //   };
  //   let returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
  //   expect(returnedBlock.data).to.deep.equal(signedBlock, "blindedBlock must be returned");
  //   produceBlockOpts = {
  //     strictFeeRecipientCheck: false,
  //     expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  //     isBuilderEnabled: true,
  //     builderSelection: BuilderSelection.MaxProfit,
  //   };
  //   returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
  //   expect(returnedBlock.data).to.deep.equal(signedBlock, "blindedBlock must be returned");
  // });
  // it("5. fullBlock != null, BlindedBlock =null return fullBlock", async function () {
  //   const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
  //   const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();

  //   api.validator.produceBlindedBlock.resolves();
  //   api.validator.produceBlock.resolves({data: fullBlock, blockValue: BigInt(1)});
  //   api.validator.produceBlockV2.resolves({data: fullBlock, version: ForkName.bellatrix, blockValue: BigInt(1)});

  //   let produceBlockOpts = {
  //     strictFeeRecipientCheck: false,
  //     expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  //     isBuilderEnabled: true,
  //     builderSelection: BuilderSelection.BuilderAlways,
  //   };
  //   let returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
  //   expect(returnedBlock.data).to.deep.equal(fullBlock, "fullBlock must be returned");
  //   produceBlockOpts = {
  //     strictFeeRecipientCheck: false,
  //     expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  //     isBuilderEnabled: true,
  //     builderSelection: BuilderSelection.MaxProfit,
  //   };
  //   returnedBlock = await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
  //   expect(returnedBlock.data).to.deep.equal(fullBlock, "fullBlock must be returned");
  // });
  // it("6. !fullBlock, !BlindedBlock, throw error", async function () {
  //   const signedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();

  //   api.validator.produceBlindedBlock.resolves();
  //   api.validator.produceBlock.resolves();
  //   api.validator.produceBlockV2.resolves();

  //   const produceBlockOpts = {
  //     strictFeeRecipientCheck: false,
  //     expectedFeeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  //     isBuilderEnabled: true,
  //     builderSelection: BuilderSelection.MaxProfit,
  //   };

  //   try {
  //     await produceBlockWrapper(144900, signedBlock.body.randaoReveal, "", produceBlockOpts);
  //   } catch (e) {
  //     expect(e).to.be.instanceOf(Error);
  //   }
  // });
});
