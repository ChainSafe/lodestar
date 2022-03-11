#!/bin/bash
# set -e

source parse-args.sh
source $devnetVars

currentDir=$(pwd)
setupConfigUrl=https://github.com/eth-clients/merge-testnets.git

configGitDir=$CONFIG_GIT_DIR

gethImage=$GETH_IMAGE
nethermindImage=$NETHERMIND_IMAGE

if [ ! -n "$dataDir" ] || [ ! -n "$devnetVars" ] || ([ "$elClient" != "geth" ] && [ "$elClient" != "nethermind" ] && [ "$elClient" != "ethereumjs" ]) 
then
  echo "usage: ./setup.sh --dataDir <data dir> --elClient <geth | nethermind | ethereumjs> --devetVars <devnet vars file> [--dockerWithSudo --withTerminal \"gnome-terminal --disable-factory --\"]"
  echo "example: ./setup.sh --dataDir kiln-data --elClient nethermind --devnetVars ./kiln.vars --dockerWithSudo --withTerminal \"gnome-terminal --disable-factory --\""
  echo "Note: if running on macOS where gnome-terminal is not available, remove the gnome-terminal related flags."
  echo "example: ./setup.sh --dataDir kiln-data --elClient geth --devnetVars ./kiln.vars"
  exit;
fi


mkdir $dataDir && mkdir $dataDir/lodestar && mkdir $dataDir/geth && mkdir $dataDir/nethermind && mkdir $dataDir/ethereumjs && cd $dataDir && git init && git remote add -f origin $setupConfigUrl && git config core.sparseCheckout true && echo "$configGitDir/*" >> .git/info/sparse-checkout && git pull --depth=1 origin main && cd $currentDir

if [ ! -n "$(ls -A $dataDir/$configGitDir)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/genesis.json)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/genesis.ssz)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/nethermind_genesis.json)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/el_bootnode.txt)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/bootstrap_nodes.txt)" ]
then
  echo "Configuration directory not setup properly, remove the data directory and run again."
  echo "exiting ..."
  exit;
else 
  echo "Configuration discovered!"
fi;

run_cmd(){
  execCmd=$1;
  if [ -n "$detached" ]
  then
    echo "running detached: $execCmd"
    eval "$execCmd"
  else
    if [ -n "$withTerminal" ]
    then
      execCmd="$withTerminal $execCmd"
    fi;
    echo "running: $execCmd &"
    eval "$execCmd" &
  fi;
}



if [ -n "$dockerWithSudo" ]
then 
  dockerExec="sudo docker"
else 
  dockerExec="docker"
fi;
dockerCmd="$dockerExec run"

if [ -n "$detached" ]
then 
  dockerCmd="$dockerCmd --detach --restart unless-stopped"
else
  dockerCmd="$dockerCmd --rm"
fi;

if [ -n "$withTerminal" ]
then
  dockerCmd="$dockerCmd -it" 
fi;

platform=$(uname)
bootNode=$(cat $dataDir/$configGitDir/el_bootnode.txt)
bootNode=($bootNode)
bootNodeWithSpace=$(IFS=" " ; echo "${bootNode[*]}")
bootNode=$(IFS=, ; echo "${bootNode[*]}")

if [ "$elClient" == "geth" ]
then
  echo "gethImage: $GETH_IMAGE"
  $dockerExec pull $GETH_IMAGE

  elName="$DEVNET_NAME-geth"
  if [ ! -n "$(ls -A $dataDir/geth)" ]
  then 
    echo "setting up geth directory"
    $dockerExec run --rm -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/geth:/data $GETH_IMAGE --datadir /data init /config/genesis.json
  fi;
  if [ $platform == 'Darwin' ]
  then
    elCmd="$dockerCmd --name $elName -v $currentDir/$dataDir:/data $GETH_IMAGE --bootnodes $EXTRA_BOOTNODES$bootNode --datadir /data/geth --authrpc.jwtsecret /data/jwtsecret $GETH_EXTRA_ARGS"
  else
    elCmd="$dockerCmd --name $elName --network host -v $currentDir/$dataDir:/data $GETH_IMAGE --bootnodes $EXTRA_BOOTNODES$bootNode --datadir /data/geth --authrpc.jwtsecret /data/jwtsecret $GETH_EXTRA_ARGS"
  fi
elif [ "$elClient" == "nethermind" ] 
then
  echo "nethermindImage: $NETHERMIND_IMAGE"
  $dockerExec pull $NETHERMIND_IMAGE

  elName="$DEVNET_NAME-nethermind"

  if [ $platform == 'Darwin' ]
  then
    elCmd="$dockerCmd --name $elName -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir:/data $NETHERMIND_IMAGE --datadir /data/nethermind  --Init.ChainSpecPath=/config/nethermind_genesis.json --JsonRpc.JwtSecretFile /data/jwtsecret $NETHERMIND_EXTRA_ARGS --Discovery.Bootnodes $EXTRA_BOOTNODES$bootNode"
  else
    elCmd="$dockerCmd --name $elName --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir:/data $NETHERMIND_IMAGE --datadir /data/nethermind  --Init.ChainSpecPath=/config/nethermind_genesis.json --JsonRpc.JwtSecretFile /data/jwtsecret $NETHERMIND_EXTRA_ARGS --Discovery.Bootnodes $EXTRA_BOOTNODES$bootNode"
  fi
elif [ "$elClient" == "ethereumjs" ] 
then
  echo "ethereumjsImage: $ETHEREUMJS_IMAGE"
  $dockerExec pull $ETHEREUMJS_IMAGE

  elName="$DEVNET_NAME-ethereumjs"

  if [ $platform == 'Darwin' ]
  then
    elCmd="$dockerCmd --name $elName -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir:/data $ETHEREUMJS_IMAGE --datadir /data/ethereumjs --gethGenesis /config/genesis.json $ETHEREUMJS_EXTRA_ARGS --bootnodes=$bootNodeWithSpace --jwt-secret /data/jwtsecret"
  else
    elCmd="$dockerCmd --name $elName --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir:/data $ETHEREUMJS_IMAGE --datadir /data/ethereumjs --gethGenesis /config/genesis.json $ETHEREUMJS_EXTRA_ARGS --bootnodes=$bootNodeWithSpace --jwt-secret /data/jwtsecret"
  fi
fi

echo "lodestarImage: $LODESTAR_IMAGE"
$dockerExec pull $LODESTAR_IMAGE

bootEnr=$(cat $dataDir/$configGitDir/bootstrap_nodes.txt)
bootEnr=($bootEnr)
bootEnr=$(IFS=" " ; echo "${bootEnr[*]}")

depositContractDeployBlock=$(cat $dataDir/$configGitDir/deposit_contract_block.txt)
clName="$DEVNET_NAME-lodestar"

if [ $platform == 'Darwin' ]
then
  clCmd="$dockerCmd --name $clName --net=container:$elName -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir:/data $LODESTAR_IMAGE beacon --rootDir /data/lodestar --paramsFile /config/config.yaml --genesisStateFile /config/genesis.ssz --network.connectToDiscv5Bootnodes --network.discv5.enabled true --eth1.enabled true --eth1.depositContractDeployBlock $depositContractDeployBlock  $LODESTAR_EXTRA_ARGS --bootnodesFile /config/boot_enr.yaml --jwt-secret /data/jwtsecret"
else
  clCmd="$dockerCmd --name $clName --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir:/data $LODESTAR_IMAGE beacon --rootDir /data/lodestar --paramsFile /config/config.yaml --genesisStateFile /config/genesis.ssz --network.connectToDiscv5Bootnodes --network.discv5.enabled true --eth1.enabled true --eth1.depositContractDeployBlock $depositContractDeployBlock  $LODESTAR_EXTRA_ARGS --bootnodesFile /config/boot_enr.yaml --jwt-secret /data/jwtsecret"
fi

valName="$DEVNET_NAME-validator"
if [ $platform == 'Darwin' ]
then
  valCmd="$dockerCmd --name $valName --net=container:$elName -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir:/data $LODESTAR_IMAGE validator --rootDir /data/lodestar --paramsFile /config/config.yaml $LODESTAR_VALIDATOR_ARGS"
else
  valCmd="$dockerCmd --name $valName --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir:/data $LODESTAR_IMAGE validator --rootDir /data/lodestar --paramsFile /config/config.yaml $LODESTAR_VALIDATOR_ARGS"
fi;

echo -n $JWT_SECRET > $dataDir/jwtsecret
run_cmd "$elCmd"
elPid=$!
echo "elPid= $elPid"
terminalInfo="elPid= $elPid for $elName"

if [ $platform == 'Darwin' ]
then
   # hack to allow network stack of EL to be up before starting the CL on macOs. Waiting on pid does not work
   sleep 5
fi

run_cmd "$clCmd"
clPid=$!
echo "clPid= $clPid"
terminalInfo="$terminalInfo, clPid= $clPid for $clName"

if [ -n "$withValidator" ]
then 
  run_cmd "$valCmd"
  valPid=$!
  echo "valPid= $valPid"
  terminalInfo="$terminalInfo, valPid= $valPid for $elName"
else 
   # hack to assign clPid to valPid for joint wait later
   valPid=$clPid
fi;

cleanup() {
  echo "cleaning up"
  $dockerExec rm $elName -f
  $dockerExec rm $clName -f
  $dockerExec rm $valName -f
  elPid=null
  clPid=null
  valPid=null
}

trap "echo exit signal recived;cleanup" SIGINT SIGTERM

if [ ! -n "$detached" ] && [ -n "$elPid" ] && [ -n "$clPid" ] && ([ ! -n "$withValidator" ] || [ -n "$valPid" ] )
then 
	echo "launched terminals for $terminalInfo"
	echo "you can watch observe the client logs at the respective terminals"
	echo "use ctl + c on any of these (including this) terminals to stop the process"
	echo "waiting ..."
	if [ $platform == 'Darwin' ]
	then # macOs ships with an old version of bash with wait that does not have the -n flag
	  wait $elPid
	  wait $clPid
    wait $valPid
	else
	  wait -n  $elPid $clPid $valPid 
	fi
  echo "one of the el or cl process exited, stopping and cleanup"
	cleanup
fi;

# if its not detached and is here, it means one of the processes exited/didn't launch
if [ ! -n "$detached" ] && [ -n "$elPid$clPid$valPid" ]
then
	echo "one of the processes didn't launch properly"
	cleanup
fi;

if [ -n "$detached" ]
then  
  echo "launched detached containers: $terminalInfo"
else 
  echo "exiting ..."
fi;
