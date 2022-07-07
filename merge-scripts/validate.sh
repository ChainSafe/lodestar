#!/bin/sh

if [ -n "$withValidatorMnemonic" ] && [ -n "$withValidatorKeystore" ]
then
  echo "Only of of --withValidatorMnemonic or --withValidatorKeystore options should be provided, exiting..."
  exit;
fi
if [ -n "$withValidatorMnemonic" ]
then
  withValidator="withValidatorMnemonic";
  validatorKeyArgs="$LODESTAR_VALIDATOR_MNEMONIC_ARGS"
  if [ ! -n "$validatorKeyArgs" ]
  then
    echo "To run validator with mnemonic, you need to set LODESTAR_VALIDATOR_MNEMONIC_ARGS"
    exit;
  fi;
fi;

if [ -n "$withValidatorKeystore" ]
then
  withValidator="withValidatorKeystore";
  validatorKeyArgs="$LODESTAR_VALIDATOR_KEYSTORE_ARGS"
  if [ ! -n "$validatorKeyArgs" ]
  then
    echo "To run validator with keystores, you need to set LODESTAR_VALIDATOR_KEYSTORE_ARGS"
    exit;
  fi;
fi;

if [ -n "$justVC" ] && [ ! -n "$withValidator" ]
then
  echo "To run validator, you need to provide either one of --withValidatorMnemonic or --withValidatorKeystore, exiting..."
  exit;
fi;

echo "withValidator = $withValidator, $validatorKeyArgs"
echo "detached = $detached"

if [ -n "$withTerminal" ] && [ -n "$detached" ]
then
  echo "Only of of --withTerminal or --detached options should be provided, exiting..."
  exit;
fi

if [ -n "$withValidator" ] && ( [ -n "$justEL" ] || [ -n "$justEL" ] || [ -n "$justEL" ] )
then
  echo "--withValidator can not be just with --justEL or --justCL or --justVC. Try using only --justVC."
  exit;
fi;

if [ -n "$justEL" ] && ( [ -n "$justCL" ] || [ -n "$justVC" ]  ) || [ -n "$justCL" ] && ( [ -n "$justEL" ] || [ -n "$justVC" ]  ) || [ -n "$justVC" ] && ( [ -n "$justEL" ] || [ -n "$justCL" ]  )
then
  echo "only one of --justEL, --justCL or --justVC can be used at a time. You can however start another (parallel) run(s) to spin them up separately."
  exit;
fi

if [ ! -n "$dataDir" ]
then
  echo "Please provide a data directory. If you are running fresh, the dataDir should be non existant for setup to configure it properly, exiting...";
  exit;
fi;


if [ -n "$justCL" ] && [ -n "$justVC" ]  && ([ "$elClient" != "geth" ] && [ "$elClient" != "nethermind" ] && [ "$elClient" != "ethereumjs" ] && [ "$elClient" != "besu" ]) 
then
  echo "To run EL client you need to provide one of --elClient <geth | nethermind | ethereumjs | besu>, exiting ...";
  exit;
fi

if [ ! -n "$JWT_SECRET" ]
then
  echo "You need to provide a file containing 32 bytes JWT_SECRET in hex format, exiting ..."
  exit;
fi;