import {fromHexString} from "@chainsafe/ssz";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Endpoints} from "../../../src/builder/routes.js";
import {GenericServerTestCases} from "../../utils/genericServerTest.js";

// randomly pregenerated pubkey
const pubkeyRand = "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576";
const root = new Uint8Array(32).fill(1);
const signedBlindedBeaconBlockFulu = ssz.fulu.SignedBlindedBeaconBlock.defaultValue();
signedBlindedBeaconBlockFulu.message.slot = SLOTS_PER_EPOCH;

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
    res: {data: ssz.bellatrix.SignedBuilderBid.defaultValue(), meta: {version: ForkName.bellatrix}},
  },
  submitBlindedBlock: {
    args: {signedBlindedBlock: {data: ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue()}},
    res: {data: ssz.bellatrix.ExecutionPayload.defaultValue(), meta: {version: ForkName.bellatrix}},
  },
  submitBlindedBlockV2: {
    args: {signedBlindedBlock: {data: signedBlindedBeaconBlockFulu}},
    res: undefined,
  },
};
