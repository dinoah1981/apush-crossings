"""Encrypt a bank JSON with a password so the published site never serves plaintext questions.

    python tools/encrypt_bank.py data/apush-u1u2.json data/apush-u1u2.enc.json
    (prompts for the password)

AES-256-GCM, key derived with PBKDF2-SHA256. app.js decrypts in the browser with WebCrypto.
The plaintext bank stays local (gitignored); only the .enc.json is committed.
"""
import base64, getpass, hashlib, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ITER = 250_000
src, dst = sys.argv[1], sys.argv[2]
pw = os.environ.get("BANK_PASSWORD") or getpass.getpass("Password: ")
plain = open(src, "rb").read()
json.loads(plain)  # must be valid JSON

salt, iv = os.urandom(16), os.urandom(12)
key = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITER, dklen=32)
ct = AESGCM(key).encrypt(iv, plain, None)
b64 = lambda b: base64.b64encode(b).decode()
json.dump({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}, open(dst, "w"))
print(f"wrote {dst} ({len(ct):,} bytes encrypted)")
