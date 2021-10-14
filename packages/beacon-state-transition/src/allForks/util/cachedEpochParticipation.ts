import {BasicListType, List, TreeBacked} from "@chainsafe/ssz";
import {TIMELY_HEAD_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX} from "@chainsafe/lodestar-params";
import {ParticipationFlags, Uint8} from "@chainsafe/lodestar-types";
import {MutableVector, PersistentVector, TransientVector} from "@chainsafe/persistent-ts";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {unsafeUint8ArrayToTree} from "./unsafeUint8ArrayToTree";

export interface IParticipationStatus {
  timelyHead: boolean;
  timelyTarget: boolean;
  timelySource: boolean;
}

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;

// TODO: No need to do math! All these operations can be cached before hand in a giant if
export function toParticipationFlags(data: IParticipationStatus): ParticipationFlags {
  return (
    ((data.timelySource && TIMELY_SOURCE) as number) |
    ((data.timelyHead && TIMELY_HEAD) as number) |
    ((data.timelyTarget && TIMELY_TARGET) as number)
  );
}

export function fromParticipationFlags(flags: ParticipationFlags): IParticipationStatus {
  return {
    timelySource: (TIMELY_SOURCE & flags) === TIMELY_SOURCE,
    timelyTarget: (TIMELY_TARGET & flags) === TIMELY_TARGET,
    timelyHead: (TIMELY_HEAD & flags) === TIMELY_HEAD,
  };
}

interface ICachedEpochParticipationOpts {
  type?: BasicListType<List<Uint8>>;
  tree?: Tree;
  persistent: MutableVector<IParticipationStatus>;
}

export class CachedEpochParticipation implements List<ParticipationFlags> {
  [index: number]: ParticipationFlags;
  type?: BasicListType<List<Uint8>>;
  tree?: Tree;
  persistent: MutableVector<IParticipationStatus>;

  constructor(opts: ICachedEpochParticipationOpts) {
    this.type = opts.type;
    this.tree = opts.tree;
    this.persistent = opts.persistent;
  }

  get length(): number {
    return this.persistent.length;
  }

  get(index: number): ParticipationFlags | undefined {
    const inclusionData = this.getStatus(index);
    if (!inclusionData) return undefined;
    return toParticipationFlags(inclusionData);
  }

  set(index: number, value: ParticipationFlags): void {
    this.persistent.set(index, fromParticipationFlags(value));
    if (this.type && this.tree) this.type.tree_setProperty(this.tree, index, value);
  }

  getStatus(index: number): IParticipationStatus | undefined {
    return this.persistent.get(index) ?? undefined;
  }

  setStatus(index: number, data: IParticipationStatus): void {
    if (this.type && this.tree) this.type.tree_setProperty(this.tree, index, toParticipationFlags(data));
    return this.persistent.set(index, data);
  }

  updateAllStatus(data: PersistentVector<IParticipationStatus> | TransientVector<IParticipationStatus>): void {
    this.persistent.vector = data;

    if (this.type && this.tree) {
      const packedData = new Uint8Array(data.length);
      data.forEach((d, i) => (packedData[i] = toParticipationFlags(d)));
      this.tree.rootNode = unsafeUint8ArrayToTree(packedData, this.type.getChunkDepth());
      this.type.tree_setLength(this.tree, data.length);
    }
  }

  pushStatus(data: IParticipationStatus): void {
    this.persistent.push(data);
    if (this.type && this.tree) this.type.tree_push(this.tree, toParticipationFlags(data));
  }

  push(value: ParticipationFlags): number {
    this.pushStatus(fromParticipationFlags(value));
    return this.persistent.length;
  }

  pop(): ParticipationFlags {
    const popped = this.persistent.pop();
    if (this.type && this.tree) this.type.tree_pop(this.tree);
    if (!popped) return (undefined as unknown) as ParticipationFlags;
    return toParticipationFlags(popped);
  }

  *[Symbol.iterator](): Iterator<ParticipationFlags> {
    for (const data of this.persistent) {
      yield toParticipationFlags(data);
    }
  }

  *iterateStatus(): IterableIterator<IParticipationStatus> {
    yield* this.persistent[Symbol.iterator]();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  find(fn: (value: ParticipationFlags, index: number, list: this) => boolean): ParticipationFlags | undefined {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findIndex(fn: (value: ParticipationFlags, index: number, list: this) => boolean): number {
    return -1;
  }

  forEach(fn: (value: ParticipationFlags, index: number, list: this) => void): void {
    this.persistent.forEach((value, index) =>
      (fn as (value: ParticipationFlags, index: number) => void)(toParticipationFlags(value), index)
    );
  }

  map<T>(fn: (value: ParticipationFlags, index: number) => T): T[] {
    return this.persistent.map((value, index) => fn(toParticipationFlags(value), index));
  }

  forEachStatus(fn: (value: IParticipationStatus, index: number, list: this) => void): void {
    this.persistent.forEach(fn as (t: IParticipationStatus, i: number) => void);
  }

  mapStatus<T>(fn: (value: IParticipationStatus, index: number) => T): T[] {
    return this.persistent.map((value, index) => fn(value, index));
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CachedEpochParticipationProxyHandler: ProxyHandler<CachedEpochParticipation> = {
  get(target: CachedEpochParticipation, key: PropertyKey): unknown {
    if (!Number.isNaN(Number(String(key)))) {
      return target.get(key as number);
    } else if (target[key as keyof CachedEpochParticipation] !== undefined) {
      return target[key as keyof CachedEpochParticipation];
    } else {
      if (target.type && target.tree) {
        const treeBacked = target.type.createTreeBacked(target.tree);
        if (key in treeBacked) {
          return treeBacked[key as keyof TreeBacked<List<ParticipationFlags>>];
        }
      }
      return undefined;
    }
  },
  set(target: CachedEpochParticipation, key: PropertyKey, value: ParticipationFlags): boolean {
    if (!Number.isNaN(Number(key))) {
      target.set(key as number, value);
      return true;
    }
    return false;
  },
};
