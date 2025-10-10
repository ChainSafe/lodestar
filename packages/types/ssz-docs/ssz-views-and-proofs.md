# SSZ Views & Proofs
---
title: SSZ views and Proofs
description: Understanding Lodestar’s SSZ Views, Merkle Proofs, and Generalized Indices.
tags: [ssz, lodestar, merkle-trees, proofs, ethereum, typescript]
---
# Table of Contents

- [SSZ Views & Proofs](#ssz-views--proofs)
  - [Introduction to views and proofs](#introduction-to-views-and-proofs)
    - [What are Views in SSZ?](#what-are-views-in-ssz)
    - [Why Views?](#why-views)
      - [ Views vs Values (side-by-side)](#1-views-vs-values-side-by-side)
      - [What are 'View'?](#what-are-view)
      - [Tree-backed Views](#tree-backed-views)
        - [1. TreeView](#1-treeview)
        - [Subview behaviour for tree view](#subview-behaviour-for-tree-view)
        - [2. TreeViewDU](#2-treeviewdu)
        - [Subview behaviour for the viewDU](#subview-behaviour-for-the-viewdu)
    - [ Common Operations with views](#3-common-operations-with-views)
  - [ Proofs](#4-proofs)
    - [How Merkle proofs work](#how-merkle-proofs-work)
    - [Creating proofs](#creating-proofs)
    - [Reconstructing from a Proof](#reconstructing-from-a-proof)
    - [Anatomy of a Proof](#anatomy-of-a-proof)
    - [Verifying a Proof](#verifying-a-proof)
  - [ Generalized Indices](#5-generalized-indices)
    - [What is a Generalized Index?](#what-is-a-generalized-index)
    - [Why Do We Use Generalized Indices?](#why-do-we-use-generalized-indices)
  - [ TypeScript Tips](#6-typescript-tips)
  - [ Pitfalls & Best Practices](#7-pitfalls--best-practices)
  - [ Best Practices](#8-best-practices)
  - [ Resources](#9-resources)


This guide covers **tree-backed views** and **proofs**, which are advanced SSZ features for performance and verifiability.  
If you’re new, start with the [SSZ Quickstart](./ssz-quickstart.md).

## Introduction to views and proofs
### What are Views in SSZ?  

Think of **views** as *live, Merkle-aware wrappers around SSZ data*.  

- When you call `defaultValue()`, you just get a **plain JavaScript object**.  
- When you call `defaultView()`, you get a **View**, which is:  
  - Backed by a **Merkle tree internally**  
  - Lets you **read/write fields like a normal object**, but keeps the underlying tree updated  
  - Supports **fast hashing, partial updates, and proof creation**  

In simple terms:  
**Views are SSZ objects wrapped with an internal Merkle tree.**  
They behave like normal objects, but every change you make is tracked in the tree, making hashing and proofs efficient.  

---

### Why Views?  

- Regular SSZ objects (`defaultValue()`) are just simple JS objects.  
- Views (`defaultView()`) give you an *optimized Merkle tree representation* that allows:  
  1. Partial updates  
  2. Efficient hashing  
  3. Creating and consuming proofs  

 **Analogy:**  
A View is like a **live SSZ object plugged into its Merkle tree**. You don’t have to rebuild the tree every time — it stays updated as you edit the object.  

#### Views vs Values (side-by-side)

In SSZ you will see two ways in which you can create Objects.
- 'defaultValue()' -> this creates a Plain JS object.
- 'defaultView()'  -> This creates a tree backed oject.

They may look similar but they behave different under the hood.

Plain Values **'(defaultValue())'**

Just a regular JS object.
Easy to use, but not Merkle-aware.
Every time you hash, SSZ has to recompute the entire Merkle tree from scratch.

```ts
Import { ssz} from '@lodestar/types'

//creating the object
const val = ssz.phase0.Attestation.defaultValue()

//changing the data
val.data.source.epoch = 100;

//calculating the root/ rehashing
const root1 = ssz.phase0.Attestation.hashTreeRoot(val)
```
---

#### What are 'View'?
In Lodestar, **View** is the general term for any SSZ-backed object that you interact with.
It represents an SSZ type in memory, **exposes fields, and knows how to serialize, Merkleize, and create proofs**.
A View can be:
- a BasicView (for primitives),
- a TreeView (for composite types),
- or a TreeViewDU (mutable, updatable view).

So View is the umbrella term.

#### Tree-backed Views

Lodestar has two main tree-backed views for **composite SSZ types**:

TreeView → immediate updates
TreeViewDU → deferred (commit-based) updates

Both are wrappers around a Merkle tree + SSZ type schema, exposing an object-like API for convenient property access.

1. **TreeView**
A tree view is a wrapper around a Tree and a Type that provides methods for convenient property access and ssz operations. [ merkle-backed view where every change is applied immediately.
]

Property getters return sub-views, except for basic types, which return native values. Setters, likewise, require sub-views, except for basic types, which require native views.

This tree view is a simple wrapper to tree backed data that commits any changes immediately to the tree. Changes are propagated upwards to the root parent tree.

In summary:

- Looks like a normal object, but is backed by a persistent Merkle tree.
- Getters → return sub-views (for composites) or native JS values (for primitives).
- Setters → require sub-views for composites, native values for primitives.
- Updates are incremental → only the changed branch is rehashed.
- Best for containers (like Attestation, BlockHeader) where updates are small and infrequent.

```ts
// Create a tree-backed attestation view
const attestation = ssz.phase0.Attestation.defaultView();

// Modify a field (updates tree branch immediately)
attestation.data.source.epoch = 10;

// Get the root (rehashes only changed branch)
const root = attestation.hashTreeRoot();
```

Example 2:
```ts
// Create a type
const C = new ContainerType({
  a: new VectorBasicType(new UintNumberType(1), 2),
});

// Create a tree view based on the default value
const c = C.defaultView();

// SSZ operations
c.serialize() === C.hashTreeRoot(C.defaultValue());
const root = c.hashTreeRoot();

// Getters
c.a.get(0) === 0;

// Setters
// Changes are applied immediately to the tree
c.a.set(0, 1);

// Subsequent calls to `hashTreeRoot` reflect the changes to the tree
assert(root.toString() !== c.hashTreeRoot().toString());
```

If you need to do many mutations at once see ViewDU, which defers all updates to a later commit step, paying the cost of updating the tree only once.

#### SubView behaviour for tree view
Each View manages its own Merkle tree.
If you assign one **subview** to another, Lodestar copies the tree data, but doesn’t link the views together. This means mutating one view will not affect the other, even if you originally set one equal to the other.
View implementations don't contain any internal caches beyond their internal Trees, and setting one *subview* to another will not link the views.

```ts
const c1 = C.toView({a: [0, 0]});
const c2 = C.toView({a: [1, 1]});

// c1's Tree now includes the root node of `c2.a` but no references to `c2.a` view
// Warning: this is different behaviour than ViewDU
c1.a = c2.a;

// This statement mutates ONLY c1 data
c1.a.set(0, 2);
// This statement mutates ONLY c2 data
c2.a.set(0, 3);
```
2. **Tree ViewDu**
ViewDU = View Deferred Update. This tree view caches all mutations to data and applies the changes to the tree only when requested by calling the commit method. This allows to pay to cost of navigating and updating the tree only once. This strategy is optimal for large tree manipulations that require very high performance (i.e. the Ethereum consensus beacon chain state transition).


Tree `ViewDU` is also Merkle-backed, but it lets you batch multiple updates before committing.
Great for lists and vectors (like the validator registry) where you may push/pop/replace often.
Mutations are staged in memory/ stashed someh
Call .commit() to flush all changes to the tree and update the root.
Much more efficient for frequent edits.

```ts
// Create a type
const C = new ContainerType({
  a: new VectorBasicType(new UintNumberType(1), 2),
});

// Create a tree view DU based on the default value
const c = C.defaultViewDU();

// SSZ operations
c.serialize() === C.hashTreeRoot(C.defaultValue());
const root = c.hashTreeRoot();

// Getters
c.a.get(0) === 0;

// Setters
// Changes are NOT applied immediately to the tree
c.a.set(0, 1);

// Subsequent calls to `hashTreeRoot` do NOT reflect the changes to the tree
assert(root.toString() === c.hashTreeRoot().toString());

// Until commit is called
c.commit();

assert(root.toString() !== c.hashTreeRoot().toString());
```
#### Key features

Defer tree updates until commit is called, allowing multiple nodes to tree to be set in a batch and navigating through the tree at most once
Persist caches of sub-properties to prevent tree navigation when re-reading data.

#### Subview behaviour for the viewDU
In TreeViewDU, each subview has a mutable cache for its children.
When you assign c1.a = c2.a, they share the same cache reference (the same in-memory child view). Updating one also updates the other, because both point to the same cached view.

```ts
const c1 = C.toViewDU({a: [0, 0]});
const c2 = C.toViewDU({a: [1, 1]});

// Now both c1 and c2 have a reference to the exact same cached child view
// Warning: this is different behaviour than View
c1.a = c2.a;

// This statement mutates c1 AND c2 data
c1.a.set(0, 2);
// This statement mutates c1 AND c2 data
c2.a.set(0, 3);
```

### Common Operations with views
Hhow to actually work with views in everyday SSZ use — things like serializing, hashing, cloning, committing, etc.

Views in SSZ are mutable, Merkle-tree–backed representations of data.
They allow efficient updates and partial reads without re-serializing entire objects.

Here are the main operations:

a. Serialize and Deserialize
```ts
const serialized = containerView.serialize();
const deserializedView = ContainerType.deserializeToView(serialized);
```


serialize() converts the view to raw SSZ bytes.

deserializeToView() reconstructs the same tree-backed structure.

b. Hashing
```ts
const root = containerView.hashTreeRoot();

```
Computes the Merkle root of the current state.

Used for proofs, state commitments, and verifying equality.

c. Committing Changes
```ts
containerView.commit();
```

Applies any pending mutations to the backing Merkle tree.

Needed when building proofs or comparing roots.

d. Cloning Views
```ts
const copyView = containerView.clone();
```

Produces an independent copy with its own backing tree.

e. JSON Conversion (for APIs or logs)
```ts
const json = ContainerType.toJson(containerView);
const restoredView = ContainerType.fromJson(json);
```

### Proofs
A **Merkle proof** is a compact, cryptographic way to prove that a specific piece of data exists inside a larger dataset — without revealing the entire dataset.

It’s built using a Merkle tree, where:

- Every leaf node represents a piece of data (e.g. a field value)
- Every parent node represents the hash of its two children
- The top node (root) represents the entire dataset

#### How Merkle proofs work.
To verify a proof, you only need:

- The root hash of the full dataset, and
- The proof (a minimal set of sibling hashes + the leaf value)
- If the proof recomputes the same root, the data is valid.

In Lodestar SSZ, proofs let you generate a Merkle proof for selected fields, send or store only those parts (great for light clients) and verify or reconstruct the partial object later.

Every View in Lodestar comes with methods for working with proofs.
| Method                        | Purpose                                 |
| ----------------------------- | --------------------------------------- |
| `view.createProof(paths)`     | Create a proof for selected subfields   |
| `Type.createFromProof(proof)` | Reconstruct a partial view from a proof |

Creating proofs:
```ts

import { ssz } from "@lodestar/types";

// Create a tree-backed view
const attestation = ssz.phase0.Attestation.defaultView();

// Update a field
attestation.data.source.epoch = 100;
attestation.data.target.epoch = 120;

// Create a proof for only specific subfields
const proof = attestation.createProof([
  ['data', 'source', 'epoch'],
  ['data', 'target', 'epoch'],
]);

console.log(proof);
```
The proof includes only the paths to those two fields `(source.epoch, target.epoch)`
Lodestar automatically collects the necessary sibling hashes

#### Reconstructing from a Proof

Later, someone else can use that proof to reconstruct a partial view of the object:
```ts
const partialAttestation = ssz.phase0.Attestation.createFromProof(proof);

// Access included fields
console.log(partialAttestation.data.source.epoch); // ✅ Works

// Access excluded fields
try {
  console.log(partialAttestation.aggregationBits);
} catch (e) {
  console.error("❌ Field not included in proof");
}
```
The partial view only contains the fields included in the proof — accessing anything else throws an error.

#### Anatomy of a Proof

A Lodestar SSZ proof is an object that contains:

1. type – the SSZ type definition
2. gindices – generalized indices for each field (tree positions)
3. leaves – serialized field values
4. witnesses – sibling hashes needed to recompute the root
You rarely need to inspect these manually, but here’s a conceptual breakdown:
```ts
Proof {
  type: Attestation,
  leaves: [
    { path: ['data', 'source', 'epoch'], value: 100 },
    { path: ['data', 'target', 'epoch'], value: 120 }
  ],
  witnesses: [ <hash1>, <hash2>, ... ]
}

```
#### Verifying a Proof

To verify a proof, Lodestar recomputes the Merkle root from the provided values and sibling hashes, then compares it to the expected root.

```ts
const root = attestation.hashTreeRoot();
const proofRoot = partialAttestation.hashTreeRoot();

console.log(root.equals(proofRoot)); // ✅ true if proof is valid
```

This is the same logic that Ethereum’s light clients and consensus layer use to verify data efficiently without downloading the whole chain.
### Generalized Indicies
In SSZ (Simple Serialize), every node in a Merkle tree — whether a leaf or an internal node — can be uniquely identified using a number called a generalized index (or gindex for short).

🔢 What is a Generalized Index?

A generalized index is an integer that represents the position of a node in a binary Merkle tree.

Think of the Merkle tree as a binary heap (like in computer science):
Each level doubles in size, and each node’s position can be calculated from its depth and offset.

The formula is:
gindex = 2depth+index at that depth

Let's visualize:
```
         1              <-- depth = 0 → 2^0 + 0 = 1
      /     \
     2       3          <-- depth = 1 → 2^1 + 0 = 2, 2^1 + 1 = 3
    / \     / \
   4   5   6   7        <-- depth = 2 → 2^2 + 0 = 4, 2^2 + 1 = 5, etc.
  / \ / \ / \ / \
 8 9 10 11 12 13 14 15  <-- depth = 3 → 2^3 + index = 8–15
```
So:

- Node 1 → root
- Node 2 → left child of root
- Node 3 → right child of root
- Node 4 → left child of Node 2
- Node 9 → right child of Node 4

…and so on.

Each node has a unique gindex, allowing us to refer to it precisely in the tree.
#### Why Do We Use Generalized Indices?

Generalized indices let us:

- Refer to any node unambiguously (without needing a path string).
- Build Merkle proofs efficiently, since each gindex tells you where in the tree data belongs.
- Reconstruct roots or subtrees from partial data.
- They’re used heavily in:
- SSZ multiproofs
- Lodestar’s internal tree operations
- Proof verification in Ethereum’s consensus layer
### 6. TypeScript Tips
Working with Lodestar’s SSZ proofs in TypeScript gives you type safety and better autocompletion — but it can also get tricky when mixing Views, Proofs, and raw objects.

This section gives you practical TypeScript tips to avoid the most common pitfalls.

1. Always Use the SSZ Schema to Create Views

SSZ Views and Proofs are type-driven.
Always create them through their schema (type definition), not manually.
```ts
// Correct
const attestation = ssz.phase0.Attestation.defaultView();

// Avoid creating Views manually — this loses type information
const attestation = {} as any;
```

Using `.defaultView()`, `.toView()`, or `.createFromProof()` ensures TypeScript knows what type of data and subviews you’re working with.
###  Pitfalls & Best Practices
Even though SSZ Views and Proofs feel like simple JS objects, they have Merkle-aware behavior under the hood.
These best practices will save you from hours of debugging.

| Pitfall                                  | Why It Happens                                                     | How to Fix                                                           |
| ---------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Confusing View and ViewDU behavior**   | `ViewDU` caches child subviews — assigning one links them together | Use `View` for isolated trees, `ViewDU` for batched updates          |
| **Accessing fields missing from proofs** | Proofs may not include all fields                                  | Only access paths you included in the proof                          |
| **Mixing JS objects with Views**         | Plain objects don’t update the Merkle tree                         | Always use `defaultView()` or `toView()` to wrap data                |
| **Forgetting to commit ViewDU changes**  | `ViewDU` is lazy and needs manual commits                          | Always call `.commit()` after modifying nested fields                |
| **Confusing serialization with hashing** | Both return bytes but represent different data                     | Use `.serialize()` for transport, `.hashTreeRoot()` for verification |
| **Mutating subviews incorrectly**        | Direct assignments skip the internal tree                          | Use setters or `.set()` for lists/vectors                            |
| **Comparing roots before commit**        | Uncommitted changes don’t affect root hash                         | Call `.commit()` or `.hashTreeRoot()` after updates                  |

### Best Practices

Prefer ViewDU for many small updates
```ts
const v = ssz.phase0.BeaconState.defaultViewDU();
v.validators.get(0).effectiveBalance = 32000000000n;
v.commit(); // Apply all at once

```
Use view when correctness matters more than batching
```ts
const v = ssz.phase0.Attestation.defaultView();
v.data.source.epoch = 100; // applied immediately
```
Always validate roots after proof verification.
```ts
const valid = partialAttestation.hashTreeRoot().toString() === root.toString();
```
Avoid reusing Views across unrelated trees
Each View holds its own tree reference — reusing it may mutate the wrong branch.

Leverage TypeScript type inference
Let Lodestar infer the type whenever possible — it reduces mismatches and improves editor hints.

### Resources

(Further Reading)[https://ethereum.org/developers/docs/data-structures-and-encoding/ssz/]
(Building blocks ssz)[https://eth2book.info/altair/part2/building_blocks/ssz/]
(merkle multiproofs)[https://github.com/ethereum/consensus-specs/blob/dev/ssz/merkle-proofs.md#merkle-multiproofs]
(simple serialize)[https://github.com/ethereum/consensus-specs/blob/dev/ssz/simple-serialize.md]
(Lodestar types)[https://github.com/ChainSafe/lodestar/tree/unstable/packages/types]

