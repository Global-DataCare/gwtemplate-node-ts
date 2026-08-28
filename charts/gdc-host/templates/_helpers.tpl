{{- define "gdc-host.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "gdc-host.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "gdc-host.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "gdc-host.labels" -}}
app.kubernetes.io/name: {{ include "gdc-host.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}

{{- define "gdc-host.gwServiceAccount" -}}
{{- default (printf "%s-gw" (include "gdc-host.fullname" .)) .Values.gw.serviceAccount.name -}}
{{- end -}}

{{- define "gdc-host.peerService" -}}
{{- printf "%s-peer" (include "gdc-host.fullname" .) -}}
{{- end -}}

{{- define "gdc-host.couchdbService" -}}
{{- printf "%s-couchdb" (include "gdc-host.fullname" .) -}}
{{- end -}}

{{- define "gdc-host.postgresqlService" -}}
{{- printf "%s-postgresql" (include "gdc-host.fullname" .) -}}
{{- end -}}

{{- define "gdc-host.ipfsService" -}}
{{- printf "%s-ipfs" (include "gdc-host.fullname" .) -}}
{{- end -}}

{{- define "gdc-host.redisService" -}}
{{- printf "%s-redis" (include "gdc-host.fullname" .) -}}
{{- end -}}
