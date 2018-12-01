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

describe('attestationRecord',() => {
	it('should initialize with default values when passed an empty object', () => {
        const instance = new ar.AttestationRecord({})

        assert.deepEqual(instance.fields, defaults)
    })

    it('given an arbitray object with no missing fields the class should construct an identical object', () => {
        const instance = new ar.AttestationRecord(dummyRecord)

        assert.deepEqual(instance.fields, dummyRecord)
    })

    it('given an object with missing fields, the empty fields should be set to default values', () => {
        const instance = new ar.AttestationRecord(missingFields)
        const constructedFields = Object.keys(missingFields)
        const allFields = Object.keys(instance.fields)

        allFields
            .every(field => 
                constructedFields.includes(field)
                ? assert.deepEqual(instance.fields[field], missingFields[field])
                : assert.deepEqual(instance.fields[field], defaults[field])
            )

    })
})
