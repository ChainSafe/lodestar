import {BasicListType, List, TreeBacked} from "@chainsafe/ssz";
import {ParticipationFlags, Uint8} from "@chainsafe/lodestar-types";
import {MutableVector, PersistentVector, TransientVector} from "@chainsafe/persistent-ts";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {unsafeUint8ArrayToTree} from "../util/unsafeUint8ArrayToTree";

interface ICachedEpochParticipationOpts {
  type?: BasicListType<List<Uint8>>;
  tree?: Tree;
  persistent: MutableVector<ParticipationFlags>;
}

export class CachedEpochParticipation implements List<ParticipationFlags> {
  [index: number]: ParticipationFlags;
  type?: BasicListType<List<Uint8>>;
  tree?: Tree;
  persistent: MutableVector<ParticipationFlags>;

  constructor(opts: ICachedEpochParticipationOpts) {
    this.type = opts.type;
    this.tree = opts.tree;
    this.persistent = opts.persistent;
  }

  get length(): number {
    return this.persistent.length;
  }

  get(index: number): ParticipationFlags | undefined {
    return this.persistent.get(index) ?? undefined;
  }

  set(index: number, value: ParticipationFlags): void {
    this.persistent.set(index, value);
    if (this.type && this.tree) this.type.tree_setProperty(this.tree, index, value);
  }

  updateAllStatus(data: PersistentVector<ParticipationFlags> | TransientVector<ParticipationFlags>): void {
    this.persistent.vector = data;

    if (this.type && this.tree) {
      const packedData = new Uint8Array(data.length);
      data.forEach((d, i) => (packedData[i] = d));
      this.tree.rootNode = unsafeUint8ArrayToTree(packedData, this.type.getChunkDepth());
      this.type.tree_setLength(this.tree, data.length);
    }
  }

  push(value: ParticipationFlags): number {
    this.persistent.push(value);
    if (this.type && this.tree) this.type.tree_push(this.tree, value);
    return this.persistent.length;
  }

  pop(): ParticipationFlags {
    const popped = this.persistent.pop();
    if (this.type && this.tree) this.type.tree_pop(this.tree);
    if (popped === undefined) return (undefined as unknown) as ParticipationFlags;
    return popped;
  }

  *[Symbol.iterator](): Iterator<ParticipationFlags> {
    for (const data of this.persistent) {
      yield data;
    }
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
    this.persistent.forEach((value, index) => (fn as (value: ParticipationFlags, index: number) => void)(value, index));
  }

  map<T>(fn: (value: ParticipationFlags, index: number) => T): T[] {
    return this.persistent.map((value, index) => fn(value, index));
  }

  forEachStatus(fn: (value: ParticipationFlags, index: number, list: this) => void): void {
    this.persistent.forEach(fn as (t: ParticipationFlags, i: number) => void);
  }

  mapStatus<T>(fn: (value: ParticipationFlags, index: number) => T): T[] {
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
