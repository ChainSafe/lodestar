import {ssz} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";

import {Api} from "../../../src/builder/routes.js";
import {GenericServerTestCases} from "../../utils/genericServerTest.js";

// randomly pregenerated pubkey
const pubkeyRand = "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576";
const root = Buffer.alloc(32, 1);

export const testData: GenericServerTestCases<Api> = {
  status: {
    args: [],
    res: undefined,
  },
  registerValidator: {
    args: [[ssz.bellatrix.SignedValidatorRegistrationV1.defaultValue()]],
    res: undefined,
  },
  getHeader: {
    args: [1, root, fromHexString(pubkeyRand)],
    res: {version: ForkName.bellatrix, data: ssz.bellatrix.SignedBuilderBid.defaultValue()},
  },
  submitBlindedBlock: {
    args: [ssz.deneb.SignedBlindedBeaconBlock.defaultValue()],
    res: {version: ForkName.bellatrix, data: ssz.bellatrix.ExecutionPayload.defaultValue()},
  },
  submitBlindedBlockV2: {
    args: [ssz.deneb.SignedBlindedBeaconBlock.defaultValue()],
    res: {version: ForkName.deneb, data: ssz.deneb.SignedBeaconBlockAndBlobsSidecar.defaultValue()},
  },
};
