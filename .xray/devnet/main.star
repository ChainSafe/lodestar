ethereum = import_module("github.com/ethpandaops/ethereum-package/main.star@bdbea4124dc8485b03991a137bb82347019b3922")

def run(plan):
    network = ethereum.run(plan, {
        "participants": [
            {
                "el_type": "geth",
                "el_image": "ethereum/client-go:v1.17.6",
                "cl_type": "lodestar",
                "cl_image": "lodestar:xray-01cc10ce",
                "count": 2,
                "validator_count": 128,
                "cl_extra_params": [
                    "--network.xrayAddress=xray:9091",
                    "--targetPeers=2",
                ],
            },
        ],
        "network_params": {
            "seconds_per_slot": 6,
            "fulu_fork_epoch": 0,
            "genesis_delay": 30,
        },
        "ethereum_genesis_generator_params": {"image": "ethpandaops/ethereum-genesis-generator:6.2.3"},
        "additional_services": [],
    })
    plan.add_service(name="xray", config=ServiceConfig(
        image="xray:lodestar-b7f562ad",
        ports={"http": PortSpec(number=9100, application_protocol="http"), "ingest": PortSpec(number=9091)},
        cmd=["--listen=0.0.0.0:9100", "--ingest=0.0.0.0:9091", "--data-dir=/tmp/xray", "--static-dir=/srv/dashboard", "--seconds-per-slot=6", "--genesis-unix={}".format(network.final_genesis_timestamp)],
    ))
    return network
