var exports = module.exports = {};
const AttestationRecord = require("./attestationRecord.js");

const Blake = require("../utils/blake.js");
const Serialize = require("../utils/serialize.js");

class Block {

    var fields = {
      // Hash of the parent block
      'parent_hash': 'hash32',
      // Slot number (for the PoS mechanism)
      'slot_number': 'int64',
      // Randao commitment reveal
      'randao_reveal': 'hash32',
      // Attestations
      'attestations': [AttestationRecord],
      // Reference to PoW chain block
      'pow_chain_ref': 'hash32',
      // Hash of the active state
      'active_state_root': 'hash32',
      // Hash of the crystallized state
      'crystallized_state_root': 'hash32'
    }

    var defaults = {
        'parent_hash': '\x00'.repeat(32),
        'slot_number': 0,
        'randao_reveal': '\x00'.repeat(32),
        'attestations': [],
        'pow_chain_ref': '\x00'.repeat(32),
        'active_state_root': '\x00'.repeat(32),
        'crystallized_state_root': '\x00'.repeat(32)
    }

    constructor(var toSet) {
      for (var key in fields) {
        if(fields.hasOwnProperty(key)) {
          if(toSet.hasOwnProperty(key)) {
            this.key = toSet.key;
          } else {
            this.key = defaults.key;
          }
        }
      }
    }

    function hash() {
        return Blake.blake(Serialize.serialize(this));
    }

    function num_attestations() {
        return this.attestations.length;
    }
}

exports.Block = Block;
