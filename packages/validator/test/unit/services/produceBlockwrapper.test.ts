import {expect} from "chai";
import sinon from "sinon";
import {createChainForkConfig} from "@lodestar/config";
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

  const config = createChainForkConfig(mainnetConfig);

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
  const testCases: [BuilderSelection, number | null, number | null, string][] = [
    [BuilderSelection.MaxProfit, 1, 0, "builder"],
    [BuilderSelection.MaxProfit, 1, 2, "engine"],
    [BuilderSelection.MaxProfit, null, 0, "engine"],
    [BuilderSelection.MaxProfit, 0, null, "builder"],

    [BuilderSelection.BuilderAlways, 1, 2, "builder"],
    [BuilderSelection.BuilderAlways, 1, 0, "builder"],
    [BuilderSelection.BuilderAlways, null, 0, "engine"],
    [BuilderSelection.BuilderAlways, 0, null, "builder"],
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
});
