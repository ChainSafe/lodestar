import {ContainerType, VectorBasicType} from "@chainsafe/ssz";
import {
  TIMELY_HEAD_FLAG_INDEX,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as denebSsz} from "../capella/index.js";

const {UintNum64} =
  primitiveSsz;

export const BeaconState = new ContainerType(
  {
    ...denebSsz.BeaconState.fields,
    netExcessPenalties: new VectorBasicType(UintNum64, TIMELY_HEAD_FLAG_INDEX)
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const SignedBeaconBlock = denebSsz.SignedBeaconBlock;
export const BeaconBlock = denebSsz.BeaconBlock;
export const BeaconBlockBody = denebSsz.BeaconBlockBody;
export const ExecutionPayload = denebSsz.ExecutionPayload;