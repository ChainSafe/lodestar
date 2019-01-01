const Migrations = artifacts.require("./Migrations.sol")
const ValidatorRegistration = artifacts.require("./ValidatorRegistration.sol")

module.exports = deployer => {
  deployer.deploy(Migrations)
  deployer.deploy(ValidatorRegistration)
}
