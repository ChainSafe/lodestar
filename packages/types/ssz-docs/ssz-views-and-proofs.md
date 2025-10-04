# SSZ Views & Proofs

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

#### 1. Views vs Values (side-by-side)

In SSZ you will see two ways in which you can create Objects.
- 'defaultValue()' -> this creates a Plain JS object.
- 'defaultView()'  -> This creates a tree backed oject.

They may look similar but they behave different under the hood.

Plain Values **'(defaultValue())'**

Just a regular JS object.
Easy to use, but not Merkle-aware.
Every time you hash, SSZ has to recompute the entire Merkle tree from scratch.

```
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
In Lodestar, View is the general term for any SSZ-backed object that you interact with.
It represents an SSZ type in memory, exposes fields, and knows how to serialize, Merkleize, and create proofs.
A View can be:
- a BasicView (for primitives),
- a TreeView (for composite types),
- or a TreeViewDU (mutable, updatable view).

So View is the umbrella term.

#### Tree-backed Views

Lodestar has two main tree-backed views for composite SSZ types:

TreeView → immediate updates

TreeViewDU → deferred (commit-based) updates

Both are wrappers around a Merkle tree + SSZ type schema, exposing an object-like API for convenient property access.
```


### 3. Common Operations with views
### 4. Proofs
### 5. TypeScript Tips
### 6. Pitfalls & Best Practices
