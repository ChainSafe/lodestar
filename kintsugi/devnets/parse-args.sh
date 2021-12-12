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
    --dockerWithSudo)
      dockerWithSudo=true
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
echo "dockerWithSudo = $dockerWithSudo"
