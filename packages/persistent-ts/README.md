# persistent-ts

Persistent data structures for TypeScript.

Persistent data structures are entirely immutable, but efficiently share elements between
each other. For example, prepending to a persisistent list only creates a new node that
references the old list. Prepending to an array, however, requires copying an entire array.
Persistent data structures are thus better suited for use in immutable environments.

This library isn't as developed as others, such as
[immutable js](https://github.com/immutable-js/immutable-js).
However, it can provide alternative data structures, and hopefully more readable implementations.
Unlike _immutable js_ specifically, this implementation is also Typescript first, whereas
that library adds type annotations after the fact. This makes for an api centered around
generics, and not necessarily acccomadating JS' indiosyncracies.

## Data Structures Implemented

This library only implements a handful of data structures at the moment.

### List

`List` is a singly linked list. Here's a sample of its operations:

```ts
// ()
List.empty<number>();

// (1, 2, 3, 4)
List.of(1, 2, 3, 4);

// (1, 2)
List.of(1).prepend(2);

// 1
List.of(1, 2, 3).head();

// (2, 3)
List.of(1, 2, 3).tail();

// (1, 2, 3)
List.of(1, 2, 3, 4).take(3);

// (4)
List.of(1, 2, 3, 4).drop(3);

//[1, 2, 3, 4]
[...List.of(1, 2, 3, 4)];
```

### Vector

`Vector` is a Radix Tree in the vein of clojure's data structure.
This can be used as an immutable sequence with efficient random access and
appending. Here's a sample of its operations:

```ts
// []
Vector.empty<number>();

// [1]
Vector.empty().append(1);

// []
Vector.of(1).pop();

// 3
Vector.of(1, 2, 3).get(2);

// [1, 2, 100]
Vector.of(1, 2, 3).set(2, 100);
```
