import {fromHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Endpoints} from "../../../src/builder/routes.js";
import {GenericServerTestCases} from "../../utils/genericServerTest.js";

// randomly pregenerated pubkey
const pubkeyRand = "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576";
const root = new Uint8Array(32).fill(1);

export const testData: GenericServerTestCases<Endpoints> = {
  status: {
    args: undefined,
    res: undefined,
  },
  registerValidator: {
    args: {registrations: [ssz.bellatrix.SignedValidatorRegistrationV1.defaultValue()]},
    res: undefined,
  },
  getHeader: {
    args: {slot: 1, parentHash: root, proposerPubkey: fromHexString(pubkeyRand)},
    res: {data: ssz.electra.SignedBuilderBid.defaultValue(), meta: {version: ForkName.electra}},
  },
  submitBlindedBlock: {
    args: {signedBlindedBlock: {data: ssz.electra.SignedBlindedBeaconBlock.defaultValue()}},
    res: {data: ssz.deneb.ExecutionPayloadAndBlobsBundle.defaultValue(), meta: {version: ForkName.electra}},
  },
  submitBlindedBlockV2: {
    args: {signedBlindedBlock: {data: ssz.fulu.SignedBlindedBeaconBlock.defaultValue()}},
    res: undefined,
  },
};
