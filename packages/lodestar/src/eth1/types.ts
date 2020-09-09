import {Bytes32, Number64, Root, DepositData, IBeaconSSZTypes} from "@chainsafe/lodestar-types";
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

export interface IEth1Block {
  blockHash: Bytes32; // Use blockHash to be consistent with the Eth1Data type
  blockNumber: Number64; // Use blockNumber to be consistent with the IEth1DataDeposit type
  timestamp: Number64;
}

export const Eth1BlockGenerator = (ssz: IBeaconSSZTypes): ContainerType<IEth1Block> =>
  new ContainerType({
    fields: {
      blockHash: ssz.Bytes32,
      blockNumber: ssz.Number64,
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
