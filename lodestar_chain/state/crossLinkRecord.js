var exports = module.exports = {};

class CrossLinkRecord {
    var fields = {
      // What epoch the crosslink was submitted in
      'epoch':'int64',
      // The block hash
      'hash':'bytes32'
    };

    var defaults = {
      'epoch':0,
      'hash': 'x00'.repeat(32)
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
