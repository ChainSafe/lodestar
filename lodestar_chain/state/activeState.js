var exports = module.exports = {};

var PartialCrossLinks = require('./partialCrosslinks.js');
var RecentProposerRecord = require('./recentProposerRecord.js');

class ActiveState {

    var fields = {
      // Block height
      'height':'int64',
      // Global RANDAO beacon state
      'randao':'bytes32',
      // Which validators have made FFG votes this epoch (as a bitfield)
      'ffg_voter_bitfield': 'bytes',
      // Block attesters in the last epoch
      'recent_attesters': ['int24'],
      // Storing data about crosslinks-in-progress attempted in this epoch
      'partial_crosslinks': [PartialCrossLinks],
      // Total number of skips (used to determine minimum timestamp)
      'total_skip_count': 'int64',
      // Block proposer in the last epoch
      'recent_proposers': [RecentProposerRecord]
    };

    var defaults = {
      'height': 0,
      'randao': 'x00'.repeat(32),
      'ffg_voter_bitfield': '',
      'recent_attesters': [],
      'partial_crosslinks': [],
      'total_skip_count': 0,
      'recent_proposers': []
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
    const numRecentAttesters() => {
      return this.recent_attesters.length;
    }

    // Returns the number of recent proposers
    const numRecentProposers() => {
      return this.recent_proposers.length;
    }
}

exports.ActiveState = ActiveState;
