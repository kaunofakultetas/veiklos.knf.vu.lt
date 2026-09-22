#!/bin/bash
# -----------------------------------------------------------
#  [*] SAML — SP key pair generator
#
#  Makes the RSA key + self-signed certificate the app shows
#  VU SSO: the certificate goes into our SP metadata (signing
#  and encryption), the key stays with the backend to sign
#  requests and decrypt assertions.
#
#  Each run lands in _SAML/new_keys/YYYY-MM-DD--HH-MM/ and
#  never touches the pair in use — activating one is a
#  deliberate step (point the compose SP_*_PATH at it).
#  VU registers the certificate, so generate once, back it
#  up, and rerun only on purpose.
#
#  Usage:  ./generateSamlKeys.sh [common-name]
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"



# STEP 1: Where this run goes
# ===========================
CN="veiklos.knf.vu.lt"
OUT="_SAML/new_keys/$(date +%Y-%m-%d--%H-%M)"
mkdir -p "$OUT"



# STEP 2: Key + self-signed certificate (10 years, no passphrase)
# ==============================================================
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
    -subj "/C=LT/O=Vilnius University Kaunas Faculty/CN=$CN" \
    -keyout "$OUT/sp-private.key" \
    -out    "$OUT/sp-cert.pem"



# STEP 3: Permissions — key secret, everything owned by the stack user
# ===================================================================
chmod 600 "$OUT/sp-private.key"
sudo chown -R 1000:1000 "$OUT"



# STEP 4: Report
# ==============
echo
echo "SP key pair written to $OUT/"
openssl x509 -in "$OUT/sp-cert.pem" -noout -subject -enddate -fingerprint -sha256
echo
echo "To activate, point docker-compose.yml at it:"
echo "  SP_PRIVATE_KEY_PATH: /app/certs/new_keys/$(basename "$OUT")/sp-private.key"
echo "  SP_CERT_PATH:        /app/certs/new_keys/$(basename "$OUT")/sp-cert.pem"
echo "then restart the backend and send /auth/saml/metadata to VU SSO."
