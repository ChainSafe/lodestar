# Database

There are two components for an ethereum node database.  Both the execution client and the beacon node need to hold data for a full node to work correctly.  In particular the execution node holds state such as wallet information and smart contract code. It also holds the execution blocks with the transaction record.  The beacon node is responsible for holding beacon node blocks and state. The beacon state is responsible primarily for the validator information.

These data sets can grow quite large over time so it is important to understand how to manage them so the host machine can support operations effectively.

## Beacon Node Database

## Execution Client Database