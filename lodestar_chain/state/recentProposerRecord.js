var exports = module.exports = {};

class RecentProposerRecord {
    var fields = {
      // Proposer index
      'index':'int24',
      // New RANDAO commitment
      'randao_commitment' : 'bytes32',
      // Balance delta
      'balance_delta': 'int24'
    };

    var defaults = {
      'randao_commitment': 'x00'.repeat(32),
      'balance_delta': 0
    };

    /*
    * Takes in an object with the fields that need to be initialized.
    * If a field is not initialized, it will use the default as in this.defaults
    */
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

exports.RecentProposerRecord = RecentProposerRecord;
