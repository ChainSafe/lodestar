import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {fromHexString} from "@chainsafe/ssz";

import {Api, ReqTypes} from "../../../src/builder/routes.js";
import {getClient} from "../../../src/builder/client.js";
import {getRoutes} from "../../../src/builder/server/index.js";
import {runGenericServerTest} from "../../utils/genericServerTest.js";

describe("builder", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    checkStatus: {
      args: [],
      res: undefined,
    },
    registerValidator: {
      args: [[ssz.bellatrix.SignedValidatorRegistrationV1.defaultValue()]],
      res: undefined,
    },
    getPayloadHeader: {
      args: [1, fromHexString("0x00000000000000000000000000000000"), fromHexString("0x1234")],
      res: {data: ssz.bellatrix.SignedBuilderBid.defaultValue()},
    },
    submitSignedBlindedBlock: {
      args: [ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue()],
      res: {data: ssz.bellatrix.ExecutionPayload.defaultValue()},
    },
  });
});
