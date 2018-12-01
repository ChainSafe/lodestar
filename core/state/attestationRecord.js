const fields = {
    // Slot number
    slot: 'int64',
    // Shard ID
    shard: 'int16',
    // List of block hashes that this signature is signing over that
    // are NOT part of the current chain, in order of oldest to newest
    oblique_parent_hashes: ['hash32'],
    // Block hash in the shard that we are attesting to
    shard_block_hash: 'hash32',
    // Who is participating
    attester_bitfield: 'bytes',
    // Slot of last justified block
    justified_slot: 'int64',
    // Hash of last justified block
    justified_block_hash: 'hash32',
    // The actual signature
    aggregate_sig: ['int256']
}

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
class AttestationRecord {
    constructor(toSet) {
      this.fields = Object.keys(fields).reduce((acc, key) => {
        acc[key] = toSet.hasOwnProperty(key) ? toSet[key] : defaults[key]
        return acc
      }, {})
    }
}

module.exports.AttestationRecord = AttestationRecord;
