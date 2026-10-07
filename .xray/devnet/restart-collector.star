def run(plan, args):
    plan.remove_service(name="xray")
    return plan.add_service(name="xray", config=ServiceConfig(
        image="xray:lodestar-b7f562ad",
        ports={"http": PortSpec(number=9100, application_protocol="http"), "ingest": PortSpec(number=9091)},
        cmd=["--listen=0.0.0.0:9100", "--ingest=0.0.0.0:9091", "--data-dir=/tmp/xray", "--static-dir=/srv/dashboard", "--seconds-per-slot=6", "--genesis-unix={}".format(args["genesis_time"])],
    ))
