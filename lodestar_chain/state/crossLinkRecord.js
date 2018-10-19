var exports = module.exports = {};

class CrosslinkRecord {
    var fields = {
      // Since last validator set change?
      'recently_changed': 'bool',
      // Slot number
      'slot': 'uint64',
      // Shard chain block hash
      'shard_block_hash': 'hash32'
    };

    var defaults = {
      'recently_changed': false,
      'slot': 0,
      'shard_block_hash': new Buffer(32)
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

exports.CrosslinkRecord = CrosslinkRecord;
