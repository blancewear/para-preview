"""PARA independent public SAFU institution/group catalogue collector (NOT timetables)."""
from __future__ import annotations
import argparse
import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from bs4 import BeautifulSoup
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import Request, urlopen

ROOT = 'https://ruz.narfu.ru/'
LIMIT = 5_000_000
GROUP_RX = re.compile(r'^([\w][\w.\-/]{1,39})(?:\s+|$)', re.UNICODE)


class Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.href = None
        self.label = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.href = dict(attrs).get('href')
            self.label = []

    def handle_data(self, data):
        if self.href is not None:
            self.label.append(data)

    def handle_endtag(self, tag):
        if tag == 'a' and self.href is not None:
            self.rows.append((self.href, ' '.join(' '.join(self.label).split())))
            self.href = None
            self.label = []


def query_id(href, key):
    url = urlsplit(urljoin(ROOT, href))
    if url.scheme != 'https' or url.hostname != 'ruz.narfu.ru':
        return None
    v = parse_qs(url.query).get(key, [None])[0]
    return v if v and v.isdecimal() else None


def schools(html):
    p = Links()
    p.feed(html)
    found = {}
    for href, label in p.rows:
        iid = query_id(href, 'institution')
        if iid and label:
            found.setdefault(iid, {'id': iid, 'name': label})
    return list(found.values())


def clean_program(label, group_number, offset):
    """Keep specializations while removing RUZ's duplicated display labels."""
    value = label[offset:].strip(' -–—')
    def drop_repeated_number(text):
        if text.startswith(group_number) and (len(text) == len(group_number) or text[len(group_number)] in ' .-'):
            return text[len(group_number):].lstrip(' .-')
        return text
    value = drop_repeated_number(value)
    if value.endswith(')') and ' (' in value:
        before, inside = value.rsplit(' (', 1)
        inside = drop_repeated_number(inside[:-1])
        if before.strip().casefold() == inside.strip().casefold():
            value = before.strip()
    return value or None


def _declared_course(link):
    """RUZ also encodes the course on some group ancestor containers."""
    for node in link.parents:
        if node.name in ("html", "body"):
            break
        value = node.get("data-course")
        if value is not None and re.fullmatch(r"[1-6]", str(value).strip()):
            return int(value)
        attr = " ".join(node.get("class", [])) + " " + str(node.get("id") or "")
        match = re.search(r"(?<![a-z0-9])course[_-]?([1-6])(?!\d)", attr, re.I)
        if match:
            return int(match.group(1))
    return None


def groups(html, institute):
    """Parse confirmed course/form information from visible official HTML."""
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    study_form = None
    course = None
    for tag in soup.find_all(True):
        if tag.name in ("h2", "h3", "h4", "h5", "h6"):
            text = " ".join(tag.stripped_strings).casefold()
            if "форма обучения" in text:
                if "очно-заоч" in text:
                    study_form = "очно-заочная"
                elif "заоч" in text:
                    study_form = "заочная"
                elif "очн" in text:
                    study_form = "очная"
            match = re.fullmatch(r"(?:курс\s*)?([1-6])\s*(?:-?й\s*)?курс(?:а)?", text)
            if match:
                course = int(match.group(1))
        if tag.name != "a" or not tag.has_attr("href"):
            continue
        gid = query_id(tag["href"], "group")
        label = tag.get_text(" ", strip=True)
        m = GROUP_RX.match(label)
        if not gid or not m:
            continue
        number = m.group(1).rstrip(".")
        if not number:
            continue
        row = {
            "id": gid, "number": number, "institution_id": institute,
            "program": clean_program(label, number, m.end()),
            "study_form": study_form,
            "course": _declared_course(tag) or course,
        }
        old = found.get(gid)
        if old and old["number"] != number:
            raise ValueError("Conflicting RUZ group number for id " + gid)
        if old is None or (old["course"] is None and row["course"] is not None):
            found[gid] = row
    if not found:
        text = " ".join(soup.get_text(" ", strip=True).split())
        if re.search(r"данные о группах отсутствуют в системе", text, re.I):
            return []
        raise ValueError("Missing groups in institution " + institute)
    return list(found.values())


def fetch(url):
    if urlsplit(url).hostname != 'ruz.narfu.ru':
        raise ValueError('Unexpected host')
    for attempt in range(3):
        try:
            req = Request(url, headers={
                'User-Agent': 'PARA/1.9 catalogue-only',
                'Accept-Language': 'ru-RU,ru;q=0.9',
            })
            with urlopen(req, timeout=18) as res:
                if urlsplit(res.url).hostname != 'ruz.narfu.ru':
                    raise ValueError('Unexpected redirect')
                ct = res.headers.get('Content-Type', 'text/html').split(';')[0].strip().lower()
                if ct not in {'text/html', 'text/plain'}:
                    raise ValueError('Unexpected type: ' + ct)
                raw = res.read(LIMIT + 1)
                if not 80 < len(raw) < LIMIT:
                    raise ValueError('Incomplete source page')
                return raw.decode('utf-8', 'replace')
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def collect(get=fetch, nap=lambda t: time.sleep(t)):
    institutes = schools(get(ROOT))
    if len(institutes) < 8:
        raise ValueError('Incomplete institution index')
    # The university maintains a separately addressable official RUZ college
    # catalogue which is not always linked from the main index. Verify its
    # group page as part of the same atomic catalogue refresh.
    if not any(str(item['id']) == '21' for item in institutes):
        institutes.append({
            'id': '21',
            'name': 'Технологический колледж Императора Петра I',
        })
    by_id = {}
    for index, school in enumerate(institutes):
        if index:
            nap(1.0)
        page = get(ROOT + '?groups=&institution=' + school['id'])
        records = groups(page, school['id'])
        if not records:
            raise ValueError('Missing groups in institution ' + school['id'])
        for item in records:
            old = by_id.get(item['id'])
            if old and old['number'] != item['number']:
                raise ValueError('Conflicting source group number')
            by_id.setdefault(item['id'], item)
    if len(by_id) < 150:
        raise ValueError('Catalogue suspiciously small: ' + str(len(by_id)))
    return {
        'version': 1,
        'source': ROOT,
        'university': 'safu',
        'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'institutions': institutes,
        'groups': sorted(by_id.values(), key=lambda g: (g['number'].lower(), g['id'])),
    }


def write_verified(data, file):
    if file.exists():
        previous = json.loads(file.read_text(encoding='utf-8'))
        old_count = len(previous.get('groups', []))
        if old_count >= 150 and len(data['groups']) < old_count * 0.75:
            raise ValueError('Refusing to replace a significantly larger catalogue')
    file.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', default='catalog.json')
    args = ap.parse_args()
    data = collect()
    write_verified(data, Path(args.output))
    print(f"Catalogue: {len(data['institutions'])} institutions, {len(data['groups'])} groups")


if __name__ == '__main__':
    main()
