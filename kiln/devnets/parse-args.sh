#!/bin/sh

while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
  	--elClient)
      elClient="$2"
      shift # past argument
      shift # past value
      ;;
    --dataDir)
      dataDir="$2"
      shift # past argument
      shift # past value
      ;;
    --devnetVars)
      devnetVars="$2"
      shift # past argument
      shift # past value
      ;;
    --withTerminal)
      withTerminal="$2"
      shift # past argument
      shift # past value
      ;;
    --dockerWithSudo)
      dockerWithSudo=true
      shift # past argument
      ;;
    --withValidator)
      withValidator=true
      shift # past argument
      ;;
    --justEL)
      justEL=true
      shift # past argument
      ;;
    --justCL)
      justCL=true
      shift # past argument
      ;;
    --justVC)
      justVC=true
      shift # past argument
      ;;
    --detached)
      detached=true
      shift # past argument
      ;;
    --skipImagePull)
      skipImagePull=true
      shift # past argument
      ;;
    *)    # unknown option
      shift # past argument
      ;;
  esac
done

echo "elClient = $elClient"
echo "dataDir = $dataDir"
echo "devnetVars = $devnetVars"
echo "withTerminal = $withTerminal"
echo "dockerWithSudo = $dockerWithSudo"
echo "withValidator = $withValidator"
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