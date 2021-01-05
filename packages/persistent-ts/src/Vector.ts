const BIT_WIDTH = 5;
const BIT_MASK = 0b11111;
const BRANCH_SIZE = 1 << BIT_WIDTH;
const DEFAULT_LEVEL_SHIFT = 5;

function isFullBranch(length: number): boolean {
  return (
    // initially we initialize Vector with an empty branch (DEFAULT_LEVEL_SHIFT)
    // length === 1 << 5 ||
    length === 1 << 10 || length === 1 << 15 || length === 1 << 20 || length === 1 << 25 || length === 1 << 30
  );
}

interface ILeaf<T> {
  leaf: true;
  values: T[];
}
interface IBranch<T> {
  leaf: false;
  // We have explicit nulls because when popping we can null old branches on purpose.
  nodes: (INode<T> | null)[];
}
type INode<T> = ILeaf<T> | IBranch<T>;

function emptyBranch<T>(): IBranch<T> {
  return {leaf: false, nodes: Array(BRANCH_SIZE).fill(null)};
}

function emptyLeaf<T>(): ILeaf<T> {
  return {leaf: true, values: Array(BRANCH_SIZE).fill(null)};
}

function copyNode<T>(vnode: INode<T>): INode<T> {
  if (vnode.leaf) {
    return {leaf: true, values: [...vnode.values]};
  } else {
    return {leaf: false, nodes: [...vnode.nodes]};
  }
}

function copyBranch<T>(vnode: IBranch<T>): IBranch<T> {
  return {leaf: false, nodes: [...vnode.nodes]};
}

/**
 * The main class.
 */
export class Vector<T> implements Iterable<T> {
  private constructor(
    private readonly root: IBranch<T>,
    private readonly levelShift: number,
    private readonly tail: T[],
    public readonly length: number
  ) {}

  /**
   * Create an empty vector of a certain type.
   */
  public static empty<T>(): Vector<T> {
    return new Vector(emptyBranch(), DEFAULT_LEVEL_SHIFT, Array(BRANCH_SIZE).fill(null), 0);
  }

  /**
   * Create a new vector containing certain elements.
   *
   * @param values the values that this vector will contain
   */
  public static of<T>(...values: T[]): Vector<T> {
    let acc = Vector.empty<T>();
    for (const v of values) acc = acc.append(v);
    return acc;
  }

  /**
   * O(log_32(N)) Return the value at a certain index, if it exists.
   *
   * This returns null if the index is out of the vector's bounds.
   *
   * @param index the index to look up
   */
  public get(index: number): T | null {
    if (index < 0 || index >= this.length) return null;
    if (index >= this.getTailOffset()) {
      return this.tail[index % BRANCH_SIZE];
    }
    let shift = this.levelShift;
    let cursor: INode<T> = this.root;
    while (!cursor.leaf) {
      // This cast is fine because we checked the length prior
      cursor = cursor.nodes[(index >>> shift) & BIT_MASK] as INode<T>;
      shift -= BIT_WIDTH;
    }
    return cursor.values[index & BIT_MASK];
  }

  /**
   * O(log_32(N)) Return a new vector with an element set to a new value.
   *
   * This will do nothing if the index is negative, or out of the bounds of the vector.
   *
   * @param index the index to set
   * @param value the value to set at that index
   */
  public set(index: number, value: T): Vector<T> {
    if (index < 0 || index >= this.length) return this;
    if (index >= this.getTailOffset()) {
      const newTail = [...this.tail];
      newTail[index & BIT_MASK] = value;
      // root is not changed
      return new Vector(this.root, this.levelShift, newTail, this.length);
    }
    const base = copyBranch(this.root);
    let shift = this.levelShift;
    let cursor: INode<T> = base;
    while (!cursor.leaf) {
      const subIndex = (index >>> shift) & BIT_MASK;
      // This cast is fine because we checked the length prior
      const next: INode<T> = copyNode(cursor.nodes[subIndex] as INode<T>);
      cursor.nodes[subIndex] = next;
      cursor = next;
      shift -= BIT_WIDTH;
    }
    cursor.values[index & BIT_MASK] = value;
    // tail is not changed
    return new Vector(base, this.levelShift, this.tail, this.length);
  }

  /**
   * O(log_32(N)) Append a value to the end of this vector.
   *
   * This is useful for building up a vector from values.
   *
   * @param value the value to push to the end of the vector
   */
  public append(value: T): Vector<T> {
    if (this.length - this.getTailOffset() < BRANCH_SIZE) {
      // has space in tail
      const newTail = [...this.tail];
      newTail[this.length % BRANCH_SIZE] = value;
      // root is not changed
      return new Vector(this.root, this.levelShift, newTail, this.length + 1);
    }
    let base: IBranch<T>;
    let levelShift = this.levelShift;
    if (isFullBranch(this.length - BRANCH_SIZE)) {
      base = emptyBranch();
      base.nodes[0] = this.root;
      levelShift += BIT_WIDTH;
    } else {
      base = copyBranch(this.root);
    }
    // getTailOffset is actually the 1st item in tail
    // we now move it to the tree
    const index = this.getTailOffset();
    let shift = levelShift;
    let cursor: INode<T> = base;
    while (!cursor.leaf) {
      const subIndex = (index >>> shift) & BIT_MASK;
      shift -= BIT_WIDTH;
      let next: INode<T> | null = cursor.nodes[subIndex];
      if (!next) {
        next = shift === 0 ? emptyLeaf() : emptyBranch();
      } else {
        next = copyNode(next);
      }
      cursor.nodes[subIndex] = next;
      cursor = next;
    }
    // it's safe to update cursor bc "next" is a new instance anyway
    cursor.values = [...this.tail];
    return new Vector(base, levelShift, [value, ...Array(BRANCH_SIZE - 1).fill(null)], this.length + 1);
  }

  /**
   * Return a new Vector with the last element removed.
   *
   * This does nothing if the Vector contains no elements.
   */
  public pop(): Vector<T> {
    if (this.length === 0) return this;
    // we always have a non-empty tail
    const tailLength = this.getTailLength();
    if (tailLength >= 2) {
      // ignore the last item
      const newTailLength = (this.length - 1) % BRANCH_SIZE;
      const newTail = [...this.tail.slice(0, newTailLength), ...Array(BRANCH_SIZE - newTailLength).fill(null)];
      return new Vector(this.root, this.levelShift, newTail, this.length - 1);
    }
    // tail has exactly 1 item, promote the right most leaf node as tail
    const lastItemIndexInTree = this.getTailOffset() - 1;
    // Tree has no item
    if (lastItemIndexInTree < 0) {
      return Vector.empty<T>();
    }
    const base = copyBranch(this.root);
    let shift = this.levelShift;
    let cursor: INode<T> = base;
    // we always have a parent bc we create an empty branch initially
    let parent: INode<T> | null = null;
    let subIndex: number | null = null;
    while (!cursor.leaf) {
      subIndex = (lastItemIndexInTree >>> shift) & BIT_MASK;
      // This cast is fine because we checked the length prior
      const next: INode<T> = copyNode(cursor.nodes[subIndex] as INode<T>);
      cursor.nodes[subIndex] = next;
      parent = cursor;
      cursor = next;
      shift -= BIT_WIDTH;
    }
    const newTail = [...cursor.values];
    parent!.nodes[subIndex!] = emptyLeaf<T>();
    let newLevelShift = this.levelShift;
    let newRoot: IBranch<T> = base;
    if (isFullBranch(this.length - 1 - BRANCH_SIZE)) {
      newRoot = base.nodes[0] as IBranch<T>;
      newLevelShift -= BIT_WIDTH;
    }
    return new Vector(copyBranch(newRoot), newLevelShift, newTail, this.length - 1);
  }

  /**
   * Implement Iterable interface.
   */
  public *[Symbol.iterator](): Generator<T> {
    let toYield = this.getTailOffset();
    function* iterNode(node: INode<T>): Generator<T> {
      if (node.leaf) {
        for (const v of node.values) {
          if (toYield <= 0) break;
          yield v;
          --toYield;
        }
      } else {
        for (const next of node.nodes) {
          // This check also assures us that the link won't be null
          if (toYield <= 0) break;
          yield* iterNode(next as INode<T>);
        }
      }
    }
    yield* iterNode(this.root);
    const tailLength = this.getTailLength();
    for (let i = 0; i < tailLength; i++) yield this.tail[i];
  }

  /**
   * Faster way to loop than the regular loop above.
   * Same to iterator function but this doesn't yield to improve performance.
   */
  public readOnlyForEach(func: (t: T, i: number) => void): void {
    let index = 0;
    const tailOffset = this.getTailOffset();
    const iterNode = (node: INode<T>): void => {
      if (node.leaf) {
        for (const v of node.values) {
          if (index < tailOffset) {
            func(v, index);
            index++;
          } else {
            break;
          }
        }
      } else {
        for (const next of node.nodes) {
          if (index >= tailOffset) break;
          iterNode(next as INode<T>);
        }
      }
    };
    iterNode(this.root);
    const tailLength = this.getTailLength();
    for (let i = 0; i < tailLength; i++) {
      const value = this.tail[i];
      func(value, index);
      index++;
    }
  }

  /**
   * Map to an array of T2.
   */
  public readOnlyMap<T2>(func: (t: T, i: number) => T2): T2[] {
    const result: T2[] = [];
    let index = 0;
    const tailOffset = this.getTailOffset();
    const iterNode = (node: INode<T>): void => {
      if (node.leaf) {
        for (const v of node.values) {
          if (index < tailOffset) {
            result.push(func(v, index));
            index++;
          } else {
            break;
          }
        }
      } else {
        for (const next of node.nodes) {
          if (index >= tailOffset) break;
          iterNode(next as INode<T>);
        }
      }
    };
    iterNode(this.root);
    const tailLength = this.getTailLength();
    for (let i = 0; i < tailLength; i++) {
      const value = this.tail[i];
      result.push(func(value, index));
      index++;
    }
    return result;
  }

  /**
   * Convert to regular typescript array
   */
  public toTS(): Array<T> {
    return this.readOnlyMap<T>((v) => v);
  }

  /**
   * Clone to a new vector.
   */
  public clone(): Vector<T> {
    return new Vector(this.root, this.levelShift, this.tail, this.length);
  }

  private getTailLength(): number {
    return this.length - this.getTailOffset();
  }

  private getTailOffset(): number {
    return this.length < BRANCH_SIZE ? 0 : ((this.length - 1) >>> BIT_WIDTH) << BIT_WIDTH;
  }
}
