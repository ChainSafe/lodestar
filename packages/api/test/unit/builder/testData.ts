import {ssz} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";

import {Api} from "../../../src/builder/routes.js";
import {GenericServerTestCases} from "../../utils/genericServerTest.js";

export const testData: GenericServerTestCases<Api> = {
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
};
