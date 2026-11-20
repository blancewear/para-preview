"""Independent, read-only TANDEM/Livewire timetable adapter for PARA.

Uses the university-operated https://ttt.narfu.ru for college groups whose
official RUZ pages have no lessons. This adapter is not derived from any
third-party timetable application's implementation.

It must never overwrite a verified RUZ timetable, and publishes no empty or
partially parsed response. Livewire can change: fail closed if it does.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from html.parser import HTMLParser
import html
import http.cookiejar
import json
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
from urllib.request import (
    HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener,
)

HOME = "https://ttt.narfu.ru"
MAX_BYTES = 5_000_000
VALID_GROUP = re.compile(r"[0-9A-Za-zА-Яа-яЁё_.-]{2,40}\Z")
DATE_DOT = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")
GROUP_SUFFIX = re.compile(r"\s*\(\s*\d+\s*\)\s*$")
EVENT_TYPES = {
    "лекции": "Лекция",
    "практические занятия": "Практическое занятие",
    "лабораторные занятия": "Лабораторная работа",
    "семинары": "Семинар",
    "экзамены (зачеты)": "Экзамен",
    "консультации": "Консультация",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_json(path: Path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def write_json(path: Path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(path)


class Components(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.raw = []

    def handle_starttag(self, tag, attrs):
        properties = dict(attrs)
        if properties.get("wire:initial-data"):
            self.raw.append(properties["wire:initial-data"])


def parse_bootstrap(markup):
    """Read the official Livewire component state from the actual HTML."""
    if not isinstance(markup, str) or not 100 <= len(markup) <= MAX_BYTES:
        raise ValueError("Invalid timetable homepage")
    token = re.search(r"""livewire_token\s*=\s*['"]([^'"]{8,512})['"]""", markup)
    if not token:
        token = re.search(r'<meta[^>]*name=["\']csrf-token["\'][^>]*content=["\']([^"\']+)', markup)
    if not token:
        raise ValueError("Official Livewire anti-CSRF token unavailable")
    parser = Components()
    parser.feed(markup)
    for raw in parser.raw:
        try:
            comp = json.loads(html.unescape(raw))
        except (ValueError, TypeError):
            continue
        if isinstance(comp, dict) and comp.get("fingerprint", {}).get("name") == "main-grid":
            if not isinstance(comp.get("serverMemo"), dict):
                raise ValueError("Missing Livewire server state")
            return token.group(1), comp
    raise ValueError("Official timetable Livewire component not found")


class BlockCrossHostRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urlsplit(newurl)
        if parts.scheme != "https" or parts.hostname != "ttt.narfu.ru":
            raise ValueError("Unexpected timetable redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class TANDEM:
    """Single isolated upstream session: cookies and state stay in one group."""
    def __init__(self):
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()), BlockCrossHostRedirect())
        self.token = None
        self.component = None

    def request(self, url, payload=None):
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.hostname != "ttt.narfu.ru":
            raise ValueError("Unexpected timetable host")
        headers = {
            "User-Agent": "PARA/2.0 independent university schedule reader",
            "Accept": "application/json, text/html",
        }
        if payload is not None:
            headers.update({
                "Content-Type": "application/json",
                "X-Livewire": "true",
                "X-CSRF-TOKEN": self.token or "",
            })
        req = Request(url, data=None if payload is None else json.dumps(payload).encode("utf-8"), headers=headers)
        with self.opener.open(req, timeout=25) as response:
            location = urlsplit(response.url)
            if location.scheme != "https" or location.hostname != "ttt.narfu.ru":
                raise ValueError("Untrusted timetable response host")
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES or not raw:
            raise ValueError("Invalid upstream response length")
        return raw.decode("utf-8")

    def open(self):
        self.token, self.component = parse_bootstrap(self.request(HOME + "/"))

    def call(self, method, args=None):
        if method not in {"set", "addWeek"} or self.component is None:
            raise ValueError("Unsupported timetable component method")
        fingerprint = self.component["fingerprint"]
        server_memo = self.component["serverMemo"]
        if fingerprint.get("name") != "main-grid":
            raise ValueError("Unexpected timetable component")
        payload = {
            "fingerprint": fingerprint,
            "serverMemo": server_memo,
            "updates": [{
                "type": "callMethod",
                "payload": {"id": "para", "method": method, "params": args or []},
            }],
        }
        data = json.loads(self.request(HOME + "/livewire/message/main-grid", payload))
        if not isinstance(data, dict) or not isinstance(data.get("serverMemo"), dict):
            raise ValueError("Malformed Livewire response")
        current = self.component["serverMemo"]
        for key, value in data["serverMemo"].items():
            if key == "data" and isinstance(value, dict) and isinstance(current.get("data"), dict):
                current["data"].update(value)
            else:
                current[key] = value
        self.component["fingerprint"] = data.get("fingerprint", fingerprint)
        state = current.get("data")
        if not isinstance(state, dict):
            raise ValueError("Livewire timetable events missing")
        return state


def events_from(value, result=None, depth=0):
    """Locate event records in varying server-side collections."""
    if result is None:
        result = []
    if depth > 12 or len(result) > 2000:
        raise ValueError("Unexpected Livewire event nesting")
    if isinstance(value, dict):
        if isinstance(value.get("date"), str) and isinstance(value.get("startTime"), str):
            result.append(value)
        else:
            for child in value.values():
                events_from(child, result, depth + 1)
    elif isinstance(value, list):
        for child in value:
            events_from(child, result, depth + 1)
    return result


def group_of(event):
    return GROUP_SUFFIX.sub("", str(event.get("group") or "")).strip()


def teacher_name(value):
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, dict):
        return ""
    last = str(value.get("last_name") or "").strip()
    initials = "".join(str(value.get(k) or "")[:1] + "." for k in ("first_name", "middle_name") if value.get(k))
    return " ".join(x for x in (last, initials) if x)


def classroom_room(value):
    name = str(value or "").strip()
    half = len(name) // 2
    return name[:half] if half and len(name) % 2 == 0 and name[:half] == name[half:] else name


def convert_event(event, expected_group):
    if group_of(event) != expected_group:
        raise ValueError("Wrong group event in TANDEM response")
    raw_date = str(event["date"])
    try:
        day = datetime.strptime(raw_date, "%d.%m.%Y").date() if DATE_DOT.fullmatch(raw_date) else date.fromisoformat(raw_date)
        start = datetime.strptime(str(event["startTime"])[:5], "%H:%M").time()
        end = datetime.strptime(str(event["endTime"])[:5], "%H:%M").time()
    except (ValueError, TypeError, KeyError) as exc:
        raise ValueError("Invalid timetable date or pair time") from exc
    if start >= end:
        raise ValueError("Invalid pair start/end")
    subject = str(event.get("discipline") or "").strip()
    if not 1 <= len(subject) <= 300:
        raise ValueError("Missing discipline")
    raw_teachers = event.get("teachers") or []
    if isinstance(raw_teachers, dict):
        raw_teachers = list(raw_teachers.values())
    if not isinstance(raw_teachers, list):
        raise ValueError("Invalid teacher list")
    teacher = ", ".join(t for item in raw_teachers if (t := teacher_name(item))) or None
    room = classroom_room(event.get("classroom")) or None
    address = str(event.get("address") or "").strip() or None
    if address == "Основной":
        address = None
    group_match = re.search(r"\((\d)\)\s*$", str(event.get("group") or ""))
    return {
        "date": day.isoformat(),
        "start": start.isoformat(timespec="seconds"),
        "end": end.isoformat(timespec="seconds"),
        "subject": subject,
        "lesson_type": EVENT_TYPES.get(str(event.get("groupType") or "").casefold().strip(), "Занятие"),
        "teacher": teacher,
        "room": room,
        "address": address,
        "building": None,
        "stream": None,
        "subgroup": group_match.group(1) if group_match else None,
        "source_lesson_id": None,
    }


def pick_groups(catalog):
    """Only link official RUZ IDs in the college/fishing-school catalogue."""
    result = []
    for row in catalog.get("groups", []):
        number = str(row.get("number") or "")
        if str(row.get("institution_id")) == "36" and number.startswith("1946") and VALID_GROUP.fullmatch(number):
            result.append(row)
    return result


def save(root, group, events, checked):
    if not events:
        return False
    destination = root / "data" / "schedules" / (str(group["id"]) + ".json")
    previous = read_json(destination)
    # Official RUZ data is authoritative; never replace it with TANDEM.
    if previous and previous.get("source_provider") != "ttt.narfu.ru":
        return False
    unique = {}
    for event in events:
        item = convert_event(event, group["number"])
        unique[json.dumps(item, sort_keys=True, ensure_ascii=False)] = item
    lessons = sorted(unique.values(), key=lambda x: (x["date"], x["start"], x["subject"]))
    if not lessons:
        return False
    start, end = lessons[0]["date"], lessons[-1]["date"]
    if previous:
        old = [x for period in previous.get("periods", []) for x in period.get("lessons", [])]
        overlap = sum(start <= x.get("date", "") <= end for x in old)
        if overlap >= 8 and len(lessons) < max(2, int(overlap * 0.35)):
            raise ValueError("TANDEM response suspiciously truncated")
    record = {
        "version": 1,
        "group_id": str(group["id"]),
        "group_number": group["number"],
        "cached": True,
        "source_status": "cached",
        "source_provider": "ttt.narfu.ru",
        "last_success": checked,
        "periods": [{"start": start, "end": end, "lessons": lessons}],
    }
    if previous and previous.get("periods") == record["periods"]:
        return False
    write_json(destination, record)
    return True


def collect(root: Path, *, groups_limit=6, weeks=4, pause=2, session_factory=TANDEM):
    if not 1 <= groups_limit <= 12 or not 1 <= weeks <= 6 or not 1 <= pause <= 60:
        raise ValueError("Unsafe polling parameters")
    catalog = read_json(root / "catalog.json", {})
    choices = pick_groups(catalog)
    if not choices:
        raise ValueError("No official fishing-school college groups in catalogue")
    chosen = choices[:groups_limit]
    report = {"checked_at": now_iso(), "source": HOME, "groups_selected": len(chosen),
              "with_lessons": 0, "published": 0, "empty_windows": 0, "errors": []}
    for index, group in enumerate(chosen):
        if index:
            time.sleep(pause)
        try:
            client = session_factory()
            client.open()
            all_events = []
            for week in range(weeks):
                state = client.call("set", [str(group["number"])]) if week == 0 else client.call("addWeek")
                all_events.extend(x for x in events_from(state.get("events", {}))
                                  if group_of(x) == group["number"])
            if all_events:
                report["with_lessons"] += 1
                report["published"] += int(save(root, group, all_events, report["checked_at"]))
            else:
                report["empty_windows"] += 1
        except Exception as exc:
            report["errors"].append({"group": group["number"], "error": str(exc)[:150]})
    # Do not claim healthy when every attempted official call failed.
    if len(report["errors"]) == len(chosen):
        raise RuntimeError("TANDEM source unavailable for all selected college groups")
    # Static onboarding takes the published list from data/status.json;
    # include verified TANDEM snapshots without resetting the RUZ cursor.
    status_path = root / "data" / "status.json"
    status = read_json(status_path, {}) or {}
    cache_dir = root / "data" / "schedules"
    ids = sorted(path.stem for path in cache_dir.glob("*.json") if path.stem.isdecimal())
    status["cached_ids"] = ids
    status["groups_cached_total"] = len(ids)
    status["college_checked_at"] = report["checked_at"]
    status["college_groups_selected"] = report["groups_selected"]
    status["college_groups_with_lessons"] = report["with_lessons"]
    status["college_groups_errors"] = len(report["errors"])
    write_json(status_path, status)
    return report


def main():
    parser = argparse.ArgumentParser(description="Conservative independent university TANDEM reader")
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--limit", type=int, default=6)
    parser.add_argument("--weeks", type=int, default=4)
    parser.add_argument("--pause", type=float, default=2)
    args = parser.parse_args()
    print(json.dumps(collect(args.root, groups_limit=args.limit, weeks=args.weeks, pause=args.pause), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
