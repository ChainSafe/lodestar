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
    --detached)
      detached=true
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