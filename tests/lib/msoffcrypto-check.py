"""Dev-only check: decrypt an Office file with the independent msoffcrypto-tool.
usage: python3 -I msoffcrypto-check.py <encrypted> <password> <out>  (exit 0 = decrypted)"""
import sys
import msoffcrypto
with open(sys.argv[1], 'rb') as f:
    of = msoffcrypto.OfficeFile(f)
    of.load_key(password=sys.argv[2], verify_password=True)
    with open(sys.argv[3], 'wb') as out:
        of.decrypt(out, verify_integrity=True)
print('ok')
