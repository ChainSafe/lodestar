import {IPhase1SSZTypes} from "../../../types/phase1/interface";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IBeaconSSZTypes} from "../../interface";
import * as primitive from "./primitive";
import * as shard from "./shard";
import * as custody from "./custody";
import * as misc from "./misc";
import * as beacon from "./beacon";

type ShardTypes = {[K in keyof typeof shard]: ReturnType<typeof shard[K]>};
type MiscTypes = {[K in keyof typeof misc]: ReturnType<typeof misc[K]>};
type CustodyTypes = {[K in keyof typeof custody]: ReturnType<typeof custody[K]>};
type BeaconTypes = {[K in keyof typeof beacon]: ReturnType<typeof beacon[K]>};

export function createPhase1SSTTypes(
  params: IBeaconParams,
  phase0Types: Omit<IBeaconSSZTypes, "phase1">
): IPhase1SSZTypes {
  const shardTypes: Partial<ShardTypes> = {};
  (Object.entries(shard) as [keyof typeof shard, typeof shard[keyof typeof shard]][]).forEach(([type, generator]) => {
    Object.assign(shardTypes, {
      [type]: generator(params, phase0Types, {
        ...primitive,
        ...(shardTypes as ShardTypes),
      }),
    });
  });

  const miscTypes: Partial<MiscTypes> = {};
  (Object.entries(misc) as [keyof typeof misc, typeof misc[keyof typeof misc]][]).forEach(([type, generator]) => {
    Object.assign(miscTypes, {
      [type]: generator(params, phase0Types, {
        ...primitive,
        ...(miscTypes as MiscTypes),
      }),
    });
  });

  const custodyTypes: Partial<CustodyTypes> = {};
  (Object.entries(custody) as [keyof typeof custody, typeof custody[keyof typeof custody]][]).forEach(
    ([type, generator]) => {
      Object.assign(custodyTypes, {
        [type]: generator(params, phase0Types, {
          ...primitive,
          ...(miscTypes as MiscTypes),
          ...(shardTypes as ShardTypes),
          ...(custodyTypes as CustodyTypes),
        }),
      });
    }
  );

  const beaconTypes: Partial<BeaconTypes> = {};
  (Object.entries(beacon) as [keyof typeof beacon, typeof beacon[keyof typeof beacon]][]).forEach(
    ([type, generator]) => {
      Object.assign(custodyTypes, {
        [type]: generator(params, phase0Types, {
          ...primitive,
          ...(miscTypes as MiscTypes),
          ...(shardTypes as ShardTypes),
          ...(custodyTypes as CustodyTypes),
          ...(beaconTypes as BeaconTypes),
        }),
      });
    }
  );

  return {
    ...primitive,
    ...(shardTypes as ShardTypes),
    ...(miscTypes as MiscTypes),
    ...(custodyTypes as CustodyTypes),
    ...(beaconTypes as BeaconTypes),
  };
}
