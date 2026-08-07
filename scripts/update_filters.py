#!/usr/bin/env python3
"""
Fetch upstream rules and write Quantumult X official-format filter lists.

Output format (crossutility/Quantumult-X sample.conf):
  host, example.com, Policy
  host-suffix, example.com, Policy
  host-keyword, example, Policy
  ip-cidr, 1.2.3.0/24, Policy, no-resolve
  ip6-cidr, 2001:db8::/32, Policy, no-resolve
"""

from __future__ import annotations

import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "QuantumultX" / "Filter"

UA = "WhiteBalance2800K-ruleset-updater/1.0 (+https://github.com/WhiteBalance2800K/ruleset)"

# Sukka placeholder / anti-empty markers — skip
SKIP_DOMAIN_RE = re.compile(
    r"(?:^|\.)skk\.moe$|7h15\.ru1353t|m4d3\.by\.5ukk4w",
    re.I,
)

# Surge / Clash / mixed type → QX lowercase
TYPE_MAP = {
    "domain": "host",
    "domain-suffix": "host-suffix",
    "domain-keyword": "host-keyword",
    "domain-wildcard": "host-wildcard",
    "host": "host",
    "host-suffix": "host-suffix",
    "host-keyword": "host-keyword",
    "host-wildcard": "host-wildcard",
    "user-agent": "user-agent",
    "ip-cidr": "ip-cidr",
    "ip-cidr6": "ip6-cidr",
    "ip6-cidr": "ip6-cidr",
    "ip-asn": "ip-asn",
    "geoip": "geoip",
    "final": "final",
    # url-regex is not reliable in QX filter; we skip it
}


def fetch(url: str, timeout: int = 60, retries: int = 3) -> str:
    """Fetch URL with simple retries. Raises last error if all fail."""
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            last_err = e
            print(f"  fetch attempt {attempt}/{retries} failed: {e}", file=sys.stderr)
    assert last_err is not None
    raise last_err


def fetch_first(urls: list[str]) -> tuple[str, str]:
    """Try multiple URLs; return (text, used_url)."""
    errors: list[str] = []
    for url in urls:
        try:
            return fetch(url), url
        except Exception as e:
            errors.append(f"{url}: {e}")
    raise RuntimeError("all sources failed:\n" + "\n".join(errors))


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def should_skip_match(match: str) -> bool:
    m = match.strip().strip(".")
    if not m:
        return True
    if SKIP_DOMAIN_RE.search(m):
        return True
    return False


def normalize_flag(flag: str) -> str:
    fl = flag.strip().lower()
    if fl in (
        "no-resolve",
        "force-cellular",
        "multi-interface",
        "multi-interface-balance",
    ):
        return fl
    if fl.startswith("via-interface="):
        return "via-interface=" + flag.split("=", 1)[1].strip()
    return flag.strip()


def format_rule(rule_type: str, match: str, policy: str, flags: list[str] | None = None) -> str | None:
    rt = TYPE_MAP.get(rule_type.lower())
    if not rt:
        return None
    if should_skip_match(match):
        return None
    parts = [rt, match.strip(), policy]
    if flags:
        parts.extend(normalize_flag(f) for f in flags if f.strip())
    return ", ".join(parts)


def parse_surge_like_line(line: str, policy: str) -> str | None:
    """Parse DOMAIN / DOMAIN-SUFFIX / IP-CIDR lines (Surge/Clash style)."""
    s = line.strip()
    if not s or s.startswith(("#", ";", "//")):
        return None
    if s.startswith("################") or s.startswith("EOF"):
        return None

    # TYPE,value or TYPE,value,no-resolve
    parts = [p.strip() for p in s.split(",")]
    if len(parts) < 2:
        return None

    typ = parts[0].lower()
    # Skip URL-REGEX (not standard QX filter)
    if typ in ("url-regex", "process-name", "protocol", "dst-port", "src-port"):
        return None

    # Some lines already include a policy as 3rd field (QX style)
    # e.g. HOST-SUFFIX,t.me,Telegram
    if typ in TYPE_MAP:
        match = parts[1]
        rest = parts[2:]
        # If rest[0] looks like a policy (no slash, not no-resolve), drop it and use ours
        flags: list[str] = []
        if rest:
            first = rest[0].lower()
            if first in (
                "no-resolve",
                "force-cellular",
                "multi-interface",
                "multi-interface-balance",
            ) or first.startswith("via-interface="):
                flags = rest
            else:
                # treat as foreign policy name → replace with ours; remaining are flags
                flags = rest[1:]
        return format_rule(typ, match, policy, flags)

    return None


def parse_geosite_line(line: str, policy: str) -> str | None:
    """
    MetaCubeX / geosite text list:
      example.com     → host (full)
      +.example.com   → host-suffix
      keyword:foo     → host-keyword
      regexp:bar      → skip (no QX filter equivalent we rely on)
      full:foo.com    → host
    """
    s = line.strip()
    if not s or s.startswith(("#", ";", "//")):
        return None

    if s.startswith("regexp:") or s.startswith("regex:"):
        return None

    if s.startswith("keyword:"):
        kw = s.split(":", 1)[1].strip()
        return format_rule("host-keyword", kw, policy)

    if s.startswith("full:"):
        domain = s.split(":", 1)[1].strip()
        return format_rule("host", domain, policy)

    if s.startswith("+."):
        domain = s[2:].strip()
        return format_rule("host-suffix", domain, policy)

    # bare domain → treat as full match (geosite default)
    if re.match(r"^[A-Za-z0-9_.*-]+$", s) and "." in s:
        return format_rule("host", s, policy)

    return None


def dedupe_keep_order(rules: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for r in rules:
        key = r.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def write_list(path: Path, title: str, sources: list[str], rules: list[str]) -> None:
    rules = dedupe_keep_order(rules)
    header = [
        f"# {title}",
        f"# Updated: {utc_now()}",
        f"# Format: Quantumult X official (host / host-suffix / ...)",
        f"# Auto-generated by scripts/update_filters.py — do not edit by hand",
    ]
    for src in sources:
        header.append(f"# Source: {src}")
    header.append(f"# Total: {len(rules)}")
    header.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(header + rules) + "\n", encoding="utf-8")
    print(f"  wrote {path.relative_to(ROOT)} ({len(rules)} rules)")


def update_ai() -> None:
    sources = [
        "https://ruleset.skk.moe/List/non_ip/ai.conf",
        "https://ruleset.skk.moe/List/ip/ai.conf",
    ]
    rules: list[str] = []
    for url in sources:
        print(f"fetch AI: {url}")
        text = fetch(url)
        for line in text.splitlines():
            rule = parse_surge_like_line(line, "AI")
            if rule:
                rules.append(rule)
    write_list(OUT_DIR / "ai.list", "AI (AIGC domains + ChatGPT Voice IP)", sources, rules)


def update_finance() -> None:
    # MetaCubeX geosite category-finance ← v2fly domain-list-community (popular)
    # Covers HSBC / IBKR / Schwab / Stripe / TradingView / major banks, etc.
    candidates = [
        "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-finance.list",
        "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/category-finance.list",
        "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/category-finance.list",
    ]
    print("fetch Finance ...")
    text, used = fetch_first(candidates)
    print(f"  used: {used}")
    rules: list[str] = []
    for line in text.splitlines():
        rule = parse_geosite_line(line, "Finance")
        if rule:
            rules.append(rule)
    write_list(
        OUT_DIR / "Finance.list",
        "Finance (geosite category-finance)",
        [used],
        rules,
    )


def update_from_blackmatrix7(name: str, policy: str, outfile: str | None = None) -> None:
    """Optional helper for other QX lists from blackmatrix7."""
    candidates = [
        (
            "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/"
            f"master/rule/QuantumultX/{name}/{name}.list"
        ),
        (
            "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/"
            f"rule/QuantumultX/{name}/{name}.list"
        ),
    ]
    print(f"fetch {name} ...")
    text, used = fetch_first(candidates)
    print(f"  used: {used}")
    rules: list[str] = []
    for line in text.splitlines():
        rule = parse_surge_like_line(line, policy)
        if rule:
            rules.append(rule)
    dest = OUT_DIR / (outfile or f"{name}.list")
    write_list(dest, name, [used], rules)


def main() -> int:
    print(f"OUT_DIR = {OUT_DIR}")
    update_ai()
    update_finance()

    # Other existing lists: keep in sync with blackmatrix7 when available
    optional = [
        ("Apple", "Apple", "Apple.list"),
        ("Telegram", "Telegram", "Telegram.list"),
        ("Twitter", "Twitter", "Twitter.list"),
        ("YouTube", "YouTube", "YouTube.list"),
        ("Global", "Global", "Global.list"),
    ]
    for name, policy, outfile in optional:
        try:
            update_from_blackmatrix7(name, policy, outfile)
        except Exception as e:
            print(f"  WARN skip {name}: {e}", file=sys.stderr)

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
