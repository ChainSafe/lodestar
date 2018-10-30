var exports = module.exports = {};

class AttestationSignedData {

    var fields = {
        // Chain version
        'version' : 'int64',
        // Slot number
        'slot' : 'int64',
        // Shard number
        'shard' : 'int16',
        // 31 parent hashes
        'parent_hashes' : ['hash32'],
        // Shard block hash
        'shard_block_hash' : 'hash32',
        // Slot of last justified block referenced in the attestation
        'justified_slot' : 'int64'
    }

    var defaults = {
        'version': 0,
        'slot': 0,
        'shard': 0,
        'parent_hashes': [],
        'justified_slot': 0,

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

exports.AttestationSignedData = AttestationSignedData;
