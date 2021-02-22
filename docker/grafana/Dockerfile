FROM grafana/grafana:latest

COPY provisioning/ /etc/grafana/provisioning/
COPY provisioning/dashboards/*.json /provisioning/dashboards/
COPY grafana.ini /etc/grafana.ini

# Modified datasource to work with a network_mode: host
ARG datasource_file=./datasource.yml
COPY ${datasource_file} /etc/grafana/provisioning/datasources/datasource.yml

ENV GF_AUTH_ANONYMOUS_ENABLED="true" \
  GF_AUTH_ANONYMOUS_ORG_ROLE="Admin" \
  GF_AUTH_DISABLE_LOGIN_FORM="true"

CMD [ \
  "--homepath=/usr/share/grafana", \
  "--config=/etc/grafana.ini", \
  "--packaging=docker", \
  "cfg:default.paths.data=/var/lib/grafana", \
  "cfg:default.log.mode=console", \
  "cfg:default.log.level=error" \
  ]