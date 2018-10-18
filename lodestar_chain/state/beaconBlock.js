var exports = module.exports = {};
const AttestationRecord = require("./attestationRecord.js");
const SpecialRecord = require("./specialRecord.js");

const Blake = require("../utils/blake.js");
const ssz = require('ssz');

class BeaconBlock {

    var fields = {
      // Slot number (for the PoS mechanism)
      'slot_number': 'int64',
      // Randao commitment reveal
      'randao_reveal': 'hash32',
      // Reference to PoW chain block
      'pow_chain_ref': 'hash32',
      // Skip list of ancestor block hashes (i'th item is 2^i'th ancestor i in {0,...,31})
      'ancestor_hashes': ['hash32'],
      // Hash of the active state
      'active_state_root': 'hash32',
      // Hash of the crystallized state
      'crystallized_state_root': 'hash32',
      // Attestations
      'attestations': [AttestationRecord],
      // Specials (e.g. logouts penalties)
      'specials': [SpecialRecord]

    }

    var defaults = {
        'slot_number': 0,
        'randao_reveal': new Buffer(32),
        'pow_chain_ref': new Buffer(32),
        'ancestor_hashes': []
        'active_state_root': new Buffer(32),
        'crystallized_state_root': new Buffer(32),
        'attestations': [],
        'specials' : []
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
        return Blake.blake(ssz.serialize(this, this));
    }

    function num_attestations() {
        return this.attestations.length;
    }
}

exports.BeaconBlock = BeaconBlock;
