/**
 * @module sszTypes/generators
 * */

import {ContainerType, BigIntUintType, ListType} from "@chainsafe/ssz";

import {IBeaconSSZTypes} from "../interface";
import {MAX_REQUEST_BLOCKS, P2P_ERROR_MESSAGE_MAX_LENGTH} from "..";

export const Status = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    forkDigest: ssz.ForkDigest,
    finalizedRoot: ssz.Root,
    finalizedEpoch: ssz.Epoch,
    headRoot: ssz.Root,
    headSlot: ssz.Slot,
  },
});

export const Goodbye = (ssz: IBeaconSSZTypes): BigIntUintType => ssz.Uint64;

export const Ping = (ssz: IBeaconSSZTypes): BigIntUintType => ssz.Uint64;

export const Metadata = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    seqNumber: ssz.Uint64,
    attnets: ssz.AttestationSubnets,
  },
});

export const BeaconBlocksByRangeRequest = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    startSlot: ssz.Slot,
    count: ssz.Number64,
    step: ssz.Number64,
  },
});

export const BeaconBlocksByRootRequest = (ssz: IBeaconSSZTypes): ListType => new ListType({
  elementType: ssz.Root,
  limit: MAX_REQUEST_BLOCKS,
});

export const P2pErrorMessage = (ssz: IBeaconSSZTypes): ListType => new ListType({
  elementType: ssz.Uint8,
  limit: P2P_ERROR_MESSAGE_MAX_LENGTH,
});