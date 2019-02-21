### ChainSafe ETH2.0 Projects

Note:
There is a lot of work being done that are core infrastructural pieces for Eth2.0. Contributions to any of the below repositories would be greatly appreciated. All the libraries are written in TypeScript (or in the process of being converted from pure JS to TypeScript):
<br />
\-- [PM / Meta Repo](https://github.com/ChainSafeSystems/Sharding)<br />
\|-- [Beacon Chain](https://github.com/ChainSafeSystems/lodestar_chain)<br />
\|-- [Simple Serialize (SSZ)](https://github.com/ChainSafeSystems/ssz-js)<br />
\|-- [Fixed Size Numbers](https://github.com/ChainSafeSystems/fixed-sized-numbers-ts/)<br />
\|-- [BLS Singatures and Signature Aggregation](https://github.com/ChainSafeSystems/bls-js)<br />

# ssz-js

Simple Serialize (SSZ) in pure Javascript

## Install

`npm install @chainsafesystems/ssz`

## Usage

See [API.md](API.md) for comprehensive API docs.

### Serialize:

#### Array
```
let array = [1, 2, 3]
let serialized = ssz.serialize(array, ['uint16'])
```

#### Boolean
```
let bool = true
let serialized = ssz.serialize(bool, 'bool')
```

#### Number
```
let num = 16
let serialized = ssz.serialize(num, 'uint32')
```

#### BN (Big Number)
```
const BN = require('bn.js')
let num = new BN(0xFFFFFFFFFFFFFFF0)
let searialized = ssc.serialize(num, 'uint64')
```

Note: Any value greater than `2^53 - 1` should be stored in a [BigNumber](https://github.com/indutny/bn.js)

#### Bytes
```
let bytes = Buffer.from([1,2,3])
let serialized = ssz.serialize(bytes, 'bytes')
```

We can also serialize to BytesN:
```
// Note: N === bytes.length
let arr = new Uint8Array(1)
let bytes = Buffer.from(arr.buffer)
let serialized = ssz.serialize(bytes, 'bytes1')
```

#### Object
```
let obj = {
	a: Buffer.from('hello'),
	b: 10,
	c: false
}

let types = {
	'fields' : [
		['a', 'bytes'],
		['b', 'int16'],
		['c', 'bool'],
	]
}

let serialized = ssz.serialize(obj, types)
```

### Deserialize

For deserialization we need to specify:
- data {buffer} - encoded data
- type {string | object | array} - type of data we want to decode, same as encoding types
- start {number} - optional, default: 0, start location in the data buffer from where we wish to read
```
// eg. deserialize a boolean at position 0
ssz.deserialize(buf, 'bool')
```
```
// eg. deserialize an object at position 32
let types = {
    'fields' : [
        ['a', 'bool'],
        ['b', 'uint8']
    ]
}
ssz.deserialize(buf, types, 32)
```


## Contributors

Very special thank you to [Darren Langley](https://github.com/darrenlangley) for helping build this.
