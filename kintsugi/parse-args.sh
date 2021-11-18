#!/bin/sh

while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
  	--elPath)
      elPath="$2"
      shift # past argument
      shift # past value
      ;;
    --dataDir)
      dataDir="$2"
      shift # past argument
      shift # past value
      ;;
    --ttd)
      ttd="$2"
      shift # past argument
      shift # past value
      ;;
    *)    # unknown option
      shift # past argument
      ;;
  esac
done
currentDir=$(dirname $0)

echo currentDir = $currentDir
echo elPath = $elPath
echo dataDir = $dataDir
echo ttd = $ttd
