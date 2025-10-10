# SSZ Examples

This file contains runnable TypeScript examples that demonstrate SSZ operations — from encoding to hashing, Merkleization, JSON conversion, and proof generation.

All examples assume you’ve installed `@chainsafe/ssz`.

```bash
npm install @chainsafe/ssz
```
## 1. Simple Container
```ts
import { ContainerType, UintNumberType } from "@chainsafe/ssz";

const SimpleContainer = new ContainerType({
  a: new UintNumberType(8),
  b: new UintNumberType(16),
});

const value = { a: 1, b: 500 };
const serialized = SimpleContainer.serialize(value);
console.log("Serialized:", serialized);
console.log("Deserialized:", SimpleContainer.deserialize(serialized));
```

## 2. Nested Container

```ts
import { ContainerType, ListType, UintNumberType } from "@chainsafe/ssz";

const Inner = new ContainerType({ x: new UintNumberType(8) });
const Outer = new ContainerType({
  items: new ListType(Inner, 4),
});

const value = { items: [{ x: 1 }, { x: 2 }, { x: 3 }] };
console.log("Root:", Outer.hashTreeRoot(value));
```

## 3. Lists & Vectors
```ts
import { ListType, VectorType, UintNumberType } from "@chainsafe/ssz";

const ListU8 = new ListType(new UintNumberType(8), 4);
const VectorU8 = new VectorType(new UintNumberType(8), 4);

console.log("List root:", ListU8.hashTreeRoot([1, 2, 3]));
console.log("Vector root:", VectorU8.hashTreeRoot([1, 2, 3, 4]));
```
## 4. Hashing & Merkleization

```ts
import { ContainerType, UintNumberType } from "@chainsafe/ssz";

const MyType = new ContainerType({
  balance: new UintNumberType(64),
});

const user = { balance: 1200n };
console.log("HashTreeRoot:", MyType.hashTreeRoot(user));
```
## 5. JSON Conversion

```ts
import { ContainerType, UintNumberType } from "@chainsafe/ssz";

const Account = new ContainerType({
  id: new UintNumberType(8),
  balance: new UintNumberType(64),
});

const obj = { id: 1, balance: 3000n };
const json = Account.toJson(obj);
const fromJson = Account.fromJson(json);

console.log("To JSON:", json);
console.log("From JSON:", fromJson);
```
## 6. Proofs


```ts
import { ProofType, ContainerType, UintNumberType } from "@chainsafe/ssz";

const Balance = new ContainerType({
  amount: new UintNumberType(64),
  nonce: new UintNumberType(32),
});

const data = { amount: 1000n, nonce: 42 };
const proof = ProofType.createProof(Balance, data, ["amount"]);

console.log("Proof:", proof);
```

## 7. Common View Operations

```ts
import { ContainerType, ListType, UintNumberType } from "@chainsafe/ssz";

const Container = new ContainerType({
  a: new ListType(new UintNumberType(8), 4),
});

const c1 = Container.toView({ a: [1, 2] });
const c2 = c1.clone();

// Mutate both views
c1.a.set(0, 99);
console.log(c1.a.getAll(), c2.a.getAll());
```


## 8. Advanced Example: Tree-Backed Views


```ts
import { ContainerType, UintNumberType } from "@chainsafe/ssz";

const Complex = new ContainerType({
  x: new UintNumberType(32),
  y: new UintNumberType(32),
});

const view = Complex.toView({ x: 10, y: 20 });
console.log("Root before:", view.hashTreeRoot());
view.x.set(100);
console.log("Root after mutation:", view.hashTreeRoot());
```


## To Run Examples:

You can copy any code block and run it directly in a TypeScript file:

```
ts-node ssz-examples.ts
```

## Tip
If you prefer organized files, you can still split these into:
In your own enviroment/
```
examples/
 ├─ simple-container.ts
 ├─ nested-container.ts
 ├─ lists-vectors.ts
 ├─ hashing.ts
 ├─ simple-container-json.ts
 ├─ nested-container-json.ts
 ├─ list-json.ts
 └─ hashing-json.ts

```