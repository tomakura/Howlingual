#!/bin/bash
set -e

# Configuration
CERT_NAME="Howlingual Developer"
TEMP_DIR=$(mktemp -d)
CONFIG_FILE="$TEMP_DIR/openssl-codesigning.cnf"
KEY_FILE="$TEMP_DIR/cert.key"
CRT_FILE="$TEMP_DIR/cert.crt"
P12_FILE="$TEMP_DIR/cert.p12"
PASSWORD="howlingual-codesign"

echo "Creating self-signed certificate: $CERT_NAME..."

# 1. Create OpenSSL config with Code Signing extension (OID: 1.3.6.1.5.5.7.3.3)
cat <<EOF > "$CONFIG_FILE"
[ req ]
distinguished_name  = req_distinguished_name
prompt              = no
x509_extensions     = v3_codesign

[ req_distinguished_name ]
CN                  = $CERT_NAME

[ v3_codesign ]
basicConstraints    = CA:FALSE
keyUsage            = digitalSignature
extendedKeyUsage    = 1.3.6.1.5.5.7.3.3
EOF

# 2. Generate Private Key and Self-Signed Certificate
# We use -nodes for no password on the private key file itself (it's temp)
openssl req -x509 -newkey rsa:2048 -keyout "$KEY_FILE" -out "$CRT_FILE" -days 3650 -nodes -config "$CONFIG_FILE"

# 3. Export to PKCS12 (p12) format which macOS 'security' tool likes
# OpenSSL 3.x defaults are often incompatible with macOS 'security' tool, so we use -legacy
openssl pkcs12 -export -out "$P12_FILE" -inkey "$KEY_FILE" -in "$CRT_FILE" -name "$CERT_NAME" -password "pass:$PASSWORD" -legacy

# 4. Import to Login Keychain
# -k: keychain to import into
# -P: password for p12 file
# -T: application allowed to use the key (codesign)
echo "Importing to keychain..."
security import "$P12_FILE" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASSWORD" -T /usr/bin/codesign

# 5. Clean up temporary files
rm -rf "$TEMP_DIR"

echo "Success! Certificate '$CERT_NAME' is now in your keychain and ready for code signing."
echo "You can verify it with: security find-identity -p codesigning -v"
