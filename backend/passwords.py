"""Versioned password encoding; the legacy format is verification-only.

PBKDF2-HMAC-SHA256 uses OWASP's 600,000 iteration recommendation. The
existing database salt/hash columns remain readable without a schema change.
"""
import hashlib
import hmac
import re
import secrets


ITERATIONS = 600_000
MAX_VERIFY_ITERATIONS = 2_000_000
ALGORITHM = "pbkdf2_sha256"
_HEX_DIGEST = re.compile(r"[0-9a-f]{64}\Z")


def new_salt() -> str:
    return secrets.token_hex(16)


def hash_password(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), ITERATIONS)
    return f"{ALGORITHM}${ITERATIONS}${digest.hex()}"


def verify_password(password: str, salt: str, encoded: str) -> bool:
    if _HEX_DIGEST.fullmatch(encoded):
        legacy = hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()
        return hmac.compare_digest(legacy, encoded)
    parts = encoded.split("$")
    if len(parts) != 3 or parts[0] != ALGORITHM or not _HEX_DIGEST.fullmatch(parts[2]):
        return False
    # Restrict both parsing and CPU consumption for corrupt/unsupported hashes.
    if not parts[1].isascii() or not parts[1].isdecimal() or len(parts[1]) > 7:
        return False
    iterations = int(parts[1])
    if not 100_000 <= iterations <= MAX_VERIFY_ITERATIONS:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return hmac.compare_digest(digest.hex(), parts[2])


def needs_upgrade(encoded: str) -> bool:
    if _HEX_DIGEST.fullmatch(encoded):
        return True
    # Called only after a successful verification.
    return int(encoded.split("$")[1]) < ITERATIONS
