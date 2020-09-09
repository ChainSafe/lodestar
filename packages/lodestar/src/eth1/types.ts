import {Number64, DepositData, IBeaconSSZTypes} from "@chainsafe/lodestar-types";
import {ContainerType} from "@chainsafe/ssz";

export interface IDepositEvent {
  depositData: DepositData;
  /// The block number of the log that included this `DepositData`.
  blockNumber: Number64;
  /// The index included with the deposit log.
  index: Number64;
}

export const DepositEventGenerator = (ssz: IBeaconSSZTypes): ContainerType<IDepositEvent> =>
  new ContainerType({
    fields: {
      depositData: ssz.DepositData,
      blockNumber: ssz.Number64,
      index: ssz.Number64,
    },
  });
