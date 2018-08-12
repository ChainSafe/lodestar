var exports = module.exports = {};

var AttestationRecord = require('./attestationRecord.js');

class ActiveState {

    var fields = {
      // Attestations that have not yet been processed
      'pending_attestations': [AttestationRecord],
      // Most recent 2 * CYCLE_LENGTH block hashes, older to newer
      'recent_block_hashes': ['hash32']
    };

    var defaults = {
      'pending_attestations': [],
      'recent_block_hashes': []
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

      if(toSet.hasOwnProperty('block_vote_cache')){
          this.block_vote_cache = toSet['block_vote_cache']
      } else {
          this.block_vote_cache = {}
      }
    }

    // Returns the number of recent attesters
    const function numPendingAttestations() {
      return this.pending_attestations.length;
    }

}

exports.ActiveState = ActiveState;
