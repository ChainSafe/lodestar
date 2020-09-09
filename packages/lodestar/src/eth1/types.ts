import {Bytes32, Number64, IBeaconSSZTypes} from "@chainsafe/lodestar-types";
import {ContainerType} from "@chainsafe/ssz";

export interface IEth1Block {
  hash: Bytes32;
  number: Number64;
  timestamp: Number64;
}

export const Eth1BlockGenerator = (ssz: IBeaconSSZTypes): ContainerType<IEth1Block> =>
  new ContainerType({
    fields: {
      hash: ssz.Bytes32,
      number: ssz.Number64,
      timestamp: ssz.Number64,
    },
  });
