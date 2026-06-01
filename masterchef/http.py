"""Shared HTTP client — browser UA, modest retry, conservative throttle."""
from __future__ import annotations

import time
import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
    "Referer": "https://10.com.au/",
}

_session = requests.Session()
_session.headers.update(HEADERS)


def get(url: str, *, timeout: int = 30, retries: int = 3, backoff: float = 1.5) -> str:
    last = None
    for attempt in range(retries):
        try:
            r = _session.get(url, timeout=timeout)
            if r.status_code == 200:
                r.encoding = "utf-8"
                return r.text
            last = f"HTTP {r.status_code}"
        except Exception as e:
            last = str(e)
        time.sleep(backoff * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after {retries}: {last}")
