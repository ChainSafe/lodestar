# SSZ Views & Proofs

This guide covers **tree-backed views** and **proofs**, which are advanced SSZ features for performance and verifiability.  
If you’re new, start with the [SSZ Quickstart](./ssz-quickstart.md).

## Introduction to views and proofs
### What are views in SSZ?

Think of views as live, Merkle-aware wrappers around SSZ data.
When you call defaultValue(), you just get a plain JavaScript object.
When you call defaultView(), you get a View, which is:
Backed by a Merkle tree internally.
Lets you read/write fields like an object, but keeps the underlying tree updated.
Supports fast hashing, partial updates, and proof creation.

In simple terms.
Views are SSZ objects that are wrapped with an internal Merkle tree.
They behave like normal objects, but any change you make is tracked in the tree, making hashing and proofs efficient.


### Why Views?
   - The regular SSZ objects (defaultValue()) are simple JS objects. There is nee for something else.
   - Views (defaultView()) wrat the object in s merklr tree presentation optimized for
    i. Partial updates
    ii. Efficient Hashing
    iii. Creating and consuming proofs.


Analogy: a View is a live SSZ object connected to its Merkle tree.
