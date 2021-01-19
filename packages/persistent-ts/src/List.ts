type Node<T> = {next: null} | {value: T; next: Node<T>};
// We can share a single empty node between all lists.
const EMPTY_NODE = {next: null};

/**
 * List<T> represents an immutable list containing values of type T.
 *
 * This class is implemented as a singly linked-list, with all the caveats involved.
 *
 * This class is best used when many values need to be stored and then consumed
 * linearly in a first-in-last-out fashion. If direct indexing or quick storing
 * at the front and back is needed, then a list isn't the best choice.
 *
 * Because a List is Iterable, you can loop over it using `for of` and use the spread operator.
 */
export class List<T> implements Iterable<T> {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private constructor(private readonly _node: Node<T>) {}

  /**
   * O(1) Create a new empty list.
   */
  public static empty<T>(): List<T> {
    return new List(EMPTY_NODE as Node<T>);
  }

  /**
   * O(N) Create a list from an array of values.
   *
   * @param values an array of values the list will contain, in the same order
   */
  public static of<T>(...values: T[]): List<T> {
    let ret = List.empty<T>();
    for (let i = values.length - 1; i >= 0; --i) {
      ret = ret.prepend(values[i]);
    }
    return ret;
  }

  /**
   * Check whether or not a list is empty.
   *
   * This is equivalent to checking if a list has no elements.
   */
  public isEmpty(): boolean {
    return !this._node.next;
  }

  /**
   * O(1) Add a new value to the front of the list.
   *
   * @param value the value to add to the front of the list
   */
  public prepend(value: T): List<T> {
    return new List({value, next: this._node});
  }

  /**
   * O(1) Get the value at the front of the list, if it exists.
   *
   * This function will return null if `isEmpty()` returns
   * true, or if the value at the front of the list happens to be
   * `null`. Because of this, be careful when storing values that might
   * be `null` inside the list, because this function may return `null`
   * even if the list isn't empty.
   */
  public head(): T | null {
    return this._node.next ? this._node.value : null;
  }

  /**
   * O(1) Return a list containing the values past the head of the list.
   *
   * For example: `List.of(1, 2).tail()` gives `List.of(2)`.
   *
   * If the list is empty, this method returns an empty list.
   *
   * `l.tail().prepend(l.head())` will always be `l` for any non-empty list `l`.
   */
  public tail(): List<T> {
    return this._node.next ? new List(this._node.next) : this;
  }

  /**
   * O(amount) Take a certain number of elements from the front of a List.
   *
   * If the amount is 0, and empty list is returned. Negative numbers are treated
   * the same way.
   *
   * If the list has less than the amount taken, the entire list is taken.
   *
   * @param amount the number of elements to take from the front of the list
   */
  public take(amount: number): List<T> {
    if (amount <= 0 || !this._node.next) return List.empty();
    const base: Node<T> = {
      value: this._node.value,
      next: EMPTY_NODE as Node<T>,
    };
    let latest = base;
    let list = this.tail();
    for (let i = 1; i < amount; ++i) {
      // We check specifically against empty in case a value is null inside a list
      if (list.isEmpty()) break;
      const next: Node<T> = {
        value: list.head() as T,
        next: EMPTY_NODE as Node<T>,
      };
      latest.next = next;
      latest = next;
      list = list.tail();
    }
    return new List(base);
  }

  /**
   * O(amount) Return a list with `amount` elements removed from the front.
   *
   * If `amount` is greater than or equal to the size of the list,
   * an empty list is returned.
   *
   * If `amount` is less than or equal to 0, the list is returned without modification.
   *
   * `l.drop(1)` is always equal to `l.tail()`.
   *
   * @param amount the number of elements to drop
   */
  public drop(amount: number): List<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let list: List<T> = this;
    for (let i = 0; i < amount; ++i) {
      if (list.isEmpty()) break;
      list = list.tail();
    }
    return list;
  }

  /**
   * O(Nthis) Concatenate this list and another.
   *
   * This returns a list containing all the elements in `this` followed
   * by all the elements in `that`.
   *
   * This could be done via `List.of(...this, ...that)` but this would
   * copy the elements of both lists, whereas this implementation only
   * needs to copy elements from the first list.
   *
   * @param that the list to append to this list
   */
  public concat(that: List<T>): List<T> {
    if (!this._node.next) return that;
    const base: Node<T> = {
      value: this._node.value,
      next: that._node,
    };
    let latest = base;
    let cursor = this._node.next;
    while (cursor.next) {
      const next: Node<T> = {
        value: cursor.value as T,
        next: that._node,
      };
      latest.next = next;
      latest = next;
      cursor = cursor.next;
    }
    return new List(base);
  }

  public *[Symbol.iterator](): Iterator<T> {
    let node = this._node;
    while (node.next) {
      yield node.value;
      node = node.next;
    }
  }

  /**
   * O(N) Test whether or not a list is logically equal to another.
   *
   * This returns true if the lists have the same size, and each element in a given
   * position is `===` to the element in the same position in the other list.
   *
   * @param that the list to compare for equality with this one.
   */
  public equals(that: List<T>): boolean {
    let thisNode = this._node;
    let thatNode = that._node;
    while (thisNode.next) {
      if (!thatNode.next) return false;
      if (thisNode.value !== thatNode.value) return false;
      thisNode = thisNode.next;
      thatNode = thatNode.next;
    }
    return !thatNode.next;
  }
}
