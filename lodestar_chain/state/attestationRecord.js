var exports = module.exports = {};

class AttestationRecord {

    var fields = {
        // Slot number
        'slot': 'int64',
        // Shard ID
        'shard_id': 'int16',
        // List of block hashes that this signature is signing over that
        // are NOT part of the current chain, in order of oldest to newest
        'oblique_parent_hashes': ['hash32'],
        // Block hash in the shard that we are attesting to
        'shard_block_hash': 'hash32',
        // Who is participating
        'attester_bitfield': 'bytes',
        // The actual signature
        'aggregate_sig': ['int256']
    }

    var defaults = {
        'slot': 0,
        'shard_id': 0,
        'oblique_parent_hashes': [],
        'shard_block_hash': '\x00'.repeat(32);
        'attester_bitfield': '',
        'aggregate_sig': [0, 0],

    }

    contrusctor(var toSet) {
      for(var key in fields) {
        if(fields.hasOwnProperty(key)){
          if(toSet.hasOwnProperty(key)) {
            this.key = toSet.key;
          } else {
            this.key = defaults.key;
          }
        }
      }
    }
}

exports.AttestationRecord = AttestationRecord;
