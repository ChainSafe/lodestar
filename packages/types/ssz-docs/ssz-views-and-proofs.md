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

Plain Values '(defaultValue())'

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
Tree-backed Views '(defaultView())'

- Looks like a normal object, but wrapped in a Merkle tree internally.
- Updates are incremental → only the changed branch of the tree is rehashed.
- Perfect for large objects, frequent updates, or when you need proofs.

```
// Create a tree-backed attestation view
const view = ssz.phase0.Attestation.defaultView()

// Modify a field (updates the tree branch automatically)
view.data.source.epoch = 10

// Get the root (only rehashes the changed branch, not the whole tree)
const root2 = view.hashTreeRoot()

```

| Feature                | `defaultValue()` (Plain Object) | `defaultView()` (Tree-backed View)    |
| ---------------------- | ------------------------------- | ------------------------------------- |
| Backed by Merkle tree? | ❌ No                            | ✅ Yes                                 |
| Update efficiency      | Slow (rehash full tree)         | Fast (rehash only changed branch)     |
| Proof support          | ❌ No                            | ✅ Yes                                 |
| Usage style            | Simple JS object                | Object-like, but with sub-views       |
| Best for               | Small objects, quick examples   | Large state, frequent updates, proofs |


### 2. Tree-backed Views (deep dive)
Tree views are one of the backings used by SSZ.  A backing is basically and underlying representation of the SSZ data. 
It represents SSZ values, directly as merkle tree.

A tree view is a wrapper around a Tree and a Type that provides methods for convenient property access and ssz operations.

Property getters return sub-views, except for basic types, which return native values. Setters, likewise, require sub-views, except for basic types, which require native views.

This tree view is a simple wrapper to tree backed data that commits any changes immediately to the tree. Changes are propagated upwards to the root parent tree.
```
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


### 3. Common Operations with views
### 4. Proofs
### 5. TypeScript Tips
### 6. Pitfalls & Best Practices
