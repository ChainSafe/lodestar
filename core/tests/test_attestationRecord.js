const assert = require('chai').assert;

const ar = require('../state/attestationRecord.js');

const defaults = {
    slot: 0,
    shard: 0,
    oblique_parent_hashes: [],
    shard_block_hash: new Buffer(32),
    attester_bitfield: new Buffer(''),
    justified_slot: 0,
    justified_block_hash: new Buffer(32),
    aggregate_sig: [],
}

const dummyRecord = {
    slot: 4,
    shard: 8,
    oblique_parent_hashes: [new Buffer(32)],
    shard_block_hash: new Buffer(32),
    attester_bitfield: new Buffer(''),
    justified_slot: 8,
    justified_block_hash: new Buffer(32),
    aggregate_sig: [new Buffer(32)],
}

const missingFields = {
    slot: 4,
    oblique_parent_hashes: [new Buffer(32)],
    attester_bitfield: new Buffer(''),
    justified_block_hash: new Buffer(32)
}

// Recursively compares items and handles for Arrays, Buffers, and Objects
const deepCompare = (a, b) => {
    if (Buffer.isBuffer(a)) return Buffer.compare(a, b) === 0
    else if (Array.isArray(a)) return a.every((item, i) => deepCompare(item, b[i]))
    else if (typeof a === 'object' && a !== null) return Object.keys(a).every(key => deepCompare(a[key], b[key]))
    else return a === b
}

describe('attestationRecord',() => {
	it('should initialize with default values when passed an empty object', () => {
        const instance = new ar.AttestationRecord({})

        assert(deepCompare(instance.fields, defaults), 'deep compare of fields and defaults failed')
    })

    it('given an arbitray object with no missing fields the class should construct an identical object', () => {
        const instance = new ar.AttestationRecord(dummyRecord)
       
        assert(deepCompare(instance.fields, dummyRecord))
    })

    it('given an object with missing fields, the empty fields should be set to default values', () => {
        const instance = new ar.AttestationRecord(missingFields)
        const constructedFields = Object.keys(missingFields)
        const allFields = Object.keys(instance.fields)

        assert(
            allFields
                .every(field => 
                    constructedFields.includes(field)
                    ? deepCompare(instance.fields[field], missingFields[field])
                    : deepCompare(instance.fields[field], defaults[field])
                )
            , 'Constructed object is different from comparison objects'
        )
    })
})
