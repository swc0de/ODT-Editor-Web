"""Dev-only: make a Standard-encrypted (AES-128 ECB, SHA-1, Office 2007) file to test reading.
usage: python3 -I make-standard-encrypted.py <plain.docx> <password> <out> (writes <out>.info and <out>.pkg)"""
import sys, os, struct, hashlib, olefile, io
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

plain = open(sys.argv[1], 'rb').read()
pw = sys.argv[2].encode('utf-16le')
salt = os.urandom(16)
h = hashlib.sha1(salt + pw).digest()
for i in range(50000):
    h = hashlib.sha1(struct.pack('<I', i) + h).digest()
hf = hashlib.sha1(h + struct.pack('<I', 0)).digest()
x1 = hashlib.sha1(bytes(0x36 ^ (hf[i] if i < 20 else 0) for i in range(64))).digest()
key = x1[:16]
def ecb(data):
    e = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return e.update(data) + e.finalize()
verifier = os.urandom(16)
vh = hashlib.sha1(verifier).digest() + b'\0' * 12
csp = 'Microsoft Enhanced RSA and AES Cryptographic Provider'.encode('utf-16le') + b'\0\0'
header = struct.pack('<IIIIIIII', 0x24, 0, 0x660E, 0x8004, 128, 0x18, 0, 0) + csp
info = struct.pack('<HHI', 4, 2, 0x24) + struct.pack('<I', len(header)) + header
info += struct.pack('<I', 16) + salt + ecb(verifier) + struct.pack('<I', 20) + ecb(vh)
padded = plain + b'\0' * ((16 - len(plain) % 16) % 16)
pkg = struct.pack('<Q', len(plain)) + ecb(padded)

# olefile can't create compound files: the test packs these two streams with src/core/convert/cfb.js.
open(sys.argv[3] + '.info', 'wb').write(info)
open(sys.argv[3] + '.pkg', 'wb').write(pkg)
