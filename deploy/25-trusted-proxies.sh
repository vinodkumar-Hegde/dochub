#!/bin/sh
set -eu

# Only explicitly trusted ingress networks may supply a client address.
# The API receives one sanitized address from nginx, never the raw header.
config=/tmp/dochub-trusted-proxies.conf
printf '# Generated trusted ingress configuration\n' > "$config"
if [ -n "${TRUSTED_PROXY_CIDRS:-}" ]; then
  printf 'real_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' >> "$config"
  for cidr in $TRUSTED_PROXY_CIDRS; do
    case "$cidr" in
      *[!0-9a-fA-F.:/]*|*/0|*/00|*/000)
        echo 'Invalid TRUSTED_PROXY_CIDRS: use explicit IPv4/IPv6 ingress CIDRs, never /0.' >&2
        exit 1 ;;
    esac
    case "$cidr" in
      */*) printf 'set_real_ip_from %s;\n' "$cidr" >> "$config" ;;
      *) echo 'TRUSTED_PROXY_CIDRS entries must include a network prefix.' >&2; exit 1 ;;
    esac
  done
fi
# nginx validates address and prefix syntax when starting; malformed input fails closed.
