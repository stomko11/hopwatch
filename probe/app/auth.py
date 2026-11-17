"""Admin password, signed session cookies and API tokens. Standard library only."""
import hashlib
import hmac
import os
import secrets
import time

ITER = 200_000
SESSION_DAYS = 30


def hash_password(pw: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), ITER).hex()
    return f"pbkdf2_sha256${ITER}${salt}${h}"


def check_password(pw: str, stored: str) -> bool:
    try:
        algo, it, salt, h = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(it)).hex()
        return algo == "pbkdf2_sha256" and hmac.compare_digest(calc, h)
    except (ValueError, AttributeError):
        return False


def token_hash(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


class Auth:
    def __init__(self, data_dir: str, cfg):
        self.cfg = cfg
        p = os.path.join(data_dir, "secret.key")
        if not os.path.exists(p):
            with open(p, "wb") as f:
                f.write(secrets.token_bytes(32))
            os.chmod(p, 0o600)
        with open(p, "rb") as f:
            self.key = f.read()
        self.fails = {}       # ip -> [times] for a simple login rate limit

    # ---------------------------------------------------------------- sessions
    def make_session(self) -> str:
        exp = int(time.time()) + SESSION_DAYS * 86400
        # the password hash is part of the signature: changing the password logs every session out
        sig = hmac.new(self.key, f"{exp}|{self.cfg.get()['security']['password_hash']}".encode(), hashlib.sha256).hexdigest()
        return f"{exp}.{sig}"

    def check_session(self, val: str) -> bool:
        try:
            exp, sig = val.split(".", 1)
            if int(exp) < time.time():
                return False
            want = hmac.new(self.key, f"{exp}|{self.cfg.get()['security']['password_hash']}".encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(sig, want)
        except (ValueError, AttributeError):
            return False

    def check_token(self, tok: str) -> bool:
        if not tok:
            return False
        h = token_hash(tok)
        return any(hmac.compare_digest(h, t["hash"]) for t in self.cfg.get()["security"]["tokens"])

    # ---------------------------------------------------------------- login rate limit
    def allowed(self, ip: str) -> bool:
        now = time.time()
        self.fails[ip] = [t for t in self.fails.get(ip, []) if now - t < 300]
        return len(self.fails[ip]) < 10

    def failed(self, ip: str) -> None:
        self.fails.setdefault(ip, []).append(time.time())

    # ---------------------------------------------------------------- tokens
    def new_token(self, name: str):
        tok = "hw_" + secrets.token_urlsafe(32)
        sec = self.cfg.get()["security"]
        item = {"id": secrets.token_hex(6), "name": (name or "token")[:40], "created": time.time(), "hash": token_hash(tok)}
        self.cfg.set_security(tokens=sec["tokens"] + [item])
        return tok, item

    def delete_token(self, tid: str) -> None:
        sec = self.cfg.get()["security"]
        self.cfg.set_security(tokens=[t for t in sec["tokens"] if t["id"] != tid])
