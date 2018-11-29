var exports = module.exports = {};

var AttestationRecord = require('./attestationRecord.js');
var SpecialRecord = require('./specialRecord.js');

class ActiveState {

    var fields = {
      // Attestations that have not yet been processed
      'pending_attestations': [AttestationRecord],
      // Specials not yet been processed
      'pending_specials': [SpecialRecord],
      // Most recent 2 * CYCLE_LENGTH block hashes, older to newer
      'recent_block_hashes': ['hash32'],
      // RANDAO state
      'randao_mix' : 'hash32'
    };

    var defaults = {
      'pending_attestations': [],
      'pending_specials': [],
      'recent_block_hashes': [],
      'randao_mix': new Buffer(32)
    };

    /*
    * Takes in an object with the fields that need to be initialized.
    * If a field is not initialized, it will use the default as in this.defaults
    */
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

    // Returns the number of recent attesters
    const function numPendingAttestations() {
      return this.pending_attestations.length;
    }

}

exports.ActiveState = ActiveState;
