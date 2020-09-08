import {Bytes32, Number64, Root, DepositData, IBeaconSSZTypes} from "@chainsafe/lodestar-types";
import {ContainerType} from "@chainsafe/ssz";

export interface IDepositLog {
  depositData: DepositData;
  /// The block number of the log that included this `DepositData`.
  blockNumber: Number64;
  /// The index included with the deposit log.
  index: Number64;
}

export const DepositLogGenerator = (ssz: IBeaconSSZTypes): ContainerType<IDepositLog> =>
  new ContainerType({
    fields: {
      depositData: ssz.DepositData,
      blockNumber: ssz.Number64,
      index: ssz.Number64,
    },
  });

export interface IEth1BlockHeader {
  hash: Bytes32;
  number: Number64;
  timestamp: Number64;
}

export const Eth1BlockHeaderGenerator = (ssz: IBeaconSSZTypes): ContainerType<IEth1BlockHeader> =>
  new ContainerType({
    fields: {
      hash: ssz.Bytes32,
      number: ssz.Number64,
      timestamp: ssz.Number64,
    },
  });

export interface IEth1DataDeposit {
  /// The block number of the log that included this `depositRoot`, `depositCount` values.
  blockNumber: Number64;
  depositRoot: Root;
  depositCount: Number64;
}

export const Eth1DataDepositGenerator = (ssz: IBeaconSSZTypes): ContainerType<IEth1DataDeposit> =>
  new ContainerType({
    fields: {
      blockNumber: ssz.Number64,
      depositRoot: ssz.Root,
      depositCount: ssz.Number64,
    },
  });
