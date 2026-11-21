"""PARA: independently verified official SAFU timetable publisher.
A rate-limited parallel full sweep checks all groups; only validated positive
lessons replace existing snapshots. The small VPS does not crawl RUZ.
"""
from __future__ import annotations
import argparse, json, os, re, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from http.client import RemoteDisconnected
from pathlib import Path
from ssl import SSLEOFError
from urllib.error import URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

BASE = "https://ruz.narfu.ru/"
MAX = 5_000_000
FULL_SCAN_RETRY_LIMIT = 12
TRANSIENT_NETWORK_ERRORS = (RemoteDisconnected, ConnectionResetError, TimeoutError, SSLEOFError)
DAY = re.compile(r"(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье),?\s+(\d{1,2})\.(\d{2})\.(\d{4})",re.I)
PAIR = re.compile(r"(?<![\d:])(?:([1-9])\s+)?(\d{1,2}):(\d{2})\s*[—–-]\s*(\d{1,2}):(\d{2})\s+")
GROUP = re.compile(r"\b(?:Группа|гр\.)\s*[:№#-]?\s*([0-9А-ЯA-Z](?:[0-9А-ЯA-Z_./-]{1,38}[0-9А-ЯA-Z]))",re.I)
TYPES = sorted(("Практические занятия (Практическая подготовка)","Вторая повторная промежуточная аттестация (комиссия)","Первая повторная промежуточная аттестация","Практика","Практическое занятие","Лабораторная работа","Лабораторное занятие","Лабораторные занятия","Контрольная работа","Курсовое проектирование","Диагностическое тестирование","Практические занятия","Зачет с оценкой","Зачёт с оценкой","Объявление","Занятие","Лекция","Семинар","Экзамен","Зачет","Зачёт","Дифференцированный зачет","Дифференцированный зачёт","Консультация","Собрание","Кураторский час","Курсовая работа","Курсовой проект","Федеральный интернет-экзамен (ФЭПО)","Федеральный интернет-экзамен"),key=len,reverse=True)
COURSE = re.compile(r"(?<!\w)(?:Ссылка\s+на\s+курс|Курс\s+лекций\s+на\s+платформе\s+Sakai\s+доступен\s+для\s+ознакомления)(?!\w)",re.I)
STREAM = re.compile(r'\s+Поток\s+["«]([^"»]+)["»]',re.I)
SUB = re.compile(r"\s+Подгруппа\s+(\S+)",re.I)
ROOM = re.compile(r"\s+ауд\.\s*(.+)$",re.I)
NAME = re.compile(r"[А-ЯЁA-Z][а-яёa-z-]+\s+[А-ЯЁA-Z]\.\s*[А-ЯЁA-Z]\.")
PARENS = re.compile(r"\(([^()]+)\)")

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def read(path, fallback=None):
    try: return json.loads(path.read_text(encoding="utf-8"))
    except (OSError,ValueError): return fallback

def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+".tmp")
    tmp.write_text(json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
    os.replace(tmp,path)

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.words=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ("script","style","noscript","svg"):self.skip+=1
    def handle_endtag(self,tag):
        if tag in ("script","style","noscript","svg") and self.skip:self.skip-=1
    def handle_data(self,value):
        if not self.skip:
            value=" ".join(value.replace("\xa0"," ").split())
            if value:self.words.append(value)

def get_page(gid):
    if not re.fullmatch(r"\d{1,12}",gid):raise ValueError("Invalid RUZ group id")
    url=BASE+"?"+urlencode({"group":gid,"timetable":""})
    req=Request(url,headers={"User-Agent":"PARA educational schedule mirror/1.0","Accept-Language":"ru"})
    with urlopen(req,timeout=17) as res:
        u=urlsplit(res.url)
        if u.scheme!="https" or u.hostname!="ruz.narfu.ru":raise ValueError("Unexpected redirect")
        ctype=res.headers.get("Content-Type","text/html").split(";")[0].strip().lower()
        if ctype not in ("text/html","text/plain"):raise ValueError("Unexpected content type")
        raw=res.read(MAX+1)
    if not 120<=len(raw)<=MAX:raise ValueError("Empty, truncated, oversized page")
    return raw.decode("utf-8","replace")

EMPTY_NOTE = re.compile(
    r"данные\s+о\s+расписании\s+на\s+эту\s+неделю\s+отсутствуют\s+в\s+системе"
    r"|расписани[ея]\s+(?:нет|отсутствует|не\s+опубликовано)"
    r"|занятий\s+нет|нет\s+занятий", re.I,
)


def verified_empty_dates(html, expected):
    """A positive, identity-checked source statement about its visible window.

    Not evidence of semester-wide absence; never erase an existing snapshot.
    A lesson-shaped time entry blocks this classification even if a banner exists.
    """
    if not 120 <= len(html) <= MAX:
        return []
    p = Text()
    p.feed(html)
    visible = " ".join(p.words)
    ids = {x[1].upper() for x in GROUP.finditer(visible)}
    if ids != {expected.upper()} or PAIR.search(visible) or not EMPTY_NOTE.search(visible):
        return []
    return sorted({date(int(m[3]), int(m[2]), int(m[1])).isoformat() for m in DAY.finditer(visible)})


def verified_empty_window(html, expected):
    return bool(verified_empty_dates(html, expected))


def parse_lesson(segment,day):
    m=PAIR.match(segment)
    if not m:raise ValueError("Missing timeslot")
    begin=f"{int(m[2]):02}:{m[3]}";end=f"{int(m[4]):02}:{m[5]}"
    if begin>=end or int(m[2])>23 or int(m[4])>23:raise ValueError("Bad times")
    body=segment[m.end():].strip()
    typ=next((x for x in TYPES if body.startswith(x+" ")),None)
    if typ is None:raise ValueError("Unknown lesson type: "+body[:80])
    body=body[len(typ):].strip()
    room=address=stream=subgroup=teacher=None
    x=ROOM.search(body)
    if x:
        location=x[1].strip().strip(",")
        location=COURSE.sub(" ",location).strip()
        if "," in location:room,address=[v.strip() for v in location.split(",",1)]
        else:room=location
        if address:
            # RUZ may append bare 2 3 4 / 3 4 5 labels for empty pair slots.
            tokens=address.split()
            trailing=[]
            for token in reversed(tokens):
                if token.isdecimal() and 2<=int(token)<=9 and (not trailing or int(token)==trailing[-1]-1):
                    trailing.append(int(token))
                else:
                    break
            if len(trailing)>=2 and trailing[-1] in (2,3):
                address=" ".join(tokens[:-len(trailing)])
        body=body[:x.start()].strip()
    x=STREAM.search(body)
    if x:stream=x[1].strip();body=(body[:x.start()]+body[x.end():]).strip()
    x=SUB.search(body)
    if x:subgroup=x[1].strip();body=(body[:x.start()]+body[x.end():]).strip()
    body=" ".join(COURSE.sub(" ",re.sub(r"\(\s*!\s*Вакансия\s*\)"," ",body,flags=re.I)).split())
    teachers=[x for x in PARENS.finditer(body) if NAME.fullmatch(x[1].strip())]
    if teachers:
        x=teachers[-1];teacher=x[1].strip();body=(body[:x.start()]+body[x.end():]).strip()
    if not 1<=len(body)<=300:raise ValueError("Missing or excessive subject")
    return {"date":day,"start":begin+":00","end":end+":00","subject":body,"lesson_type":typ,
            "teacher":teacher,"room":room,"address":address,"building":None,"stream":stream,
            "subgroup":subgroup,"source_lesson_id":None}

def parse(html,expected):
    if not 120<=len(html)<=MAX or re.search(r"<form[^>]*(?:login|password|auth)|captcha",html,re.I):
        raise ValueError("Not a complete RUZ timetable")
    p=Text();p.feed(html);visible=" ".join(p.words)
    ids={x[1].upper() for x in GROUP.finditer(visible)}
    if ids!={expected.upper()}:raise ValueError("RUZ group identity mismatch")
    days=list(DAY.finditer(visible))
    if not days:raise ValueError("No dated timetable sections")
    events=[];seen=set();dates=[]
    for i,day in enumerate(days):
        day_key=date(int(day[3]),int(day[2]),int(day[1])).isoformat()
        dates.append(day_key)
        chunk=visible[day.end():days[i+1].start() if i+1<len(days) else len(visible)]
        slots=list(PAIR.finditer(chunk))
        for j,slot in enumerate(slots):
            fragment=chunk[slot.start():slots[j+1].start() if j+1<len(slots) else len(chunk)]
            item=parse_lesson(fragment,day_key)
            key=json.dumps(item,ensure_ascii=False,sort_keys=True)
            if key not in seen:seen.add(key);events.append(item)
    if not events:raise ValueError("No verified lessons, not a cancellation")
    events.sort(key=lambda x:(x["date"],x["start"],x["subject"],x["subgroup"] or "",x["stream"] or ""))
    return {"start":min(dates),"end":max(dates),"lessons":events}

def store(root,group,result,now):
    gid=str(group["id"])
    if not re.fullmatch(r"\d{1,12}",gid):raise ValueError("Invalid id")
    path=root/"schedules"/(gid+".json")
    previous=read(path)
    if previous and previous.get("group_number")!=group["number"]:
        raise ValueError("Another group in the saved snapshot")
    old=[] if not previous else [l for p in previous.get("periods",[]) for l in p.get("lessons",[])]
    overlap=sum(result["start"]<=l.get("date","")<=result["end"] for l in old)
    if overlap>=8 and len(result["lessons"])<max(2,int(overlap*.35)):
        raise ValueError("Incomplete source vs cached schedule")
    period={k:result[k] for k in ("start","end","lessons")}
    if previous and previous.get("periods")==[period]:return False
    write(path,{"version":1,"group_id":gid,"group_number":group["number"],"cached":True,
                "source_status":"cached","last_success":now,"periods":[period]})
    return True

def selected(catalog,cursor,limit):
    groups=catalog.get("groups",[])
    if not 150<=len(groups)<=5000 or len({g["id"] for g in groups})!=len(groups):
        raise ValueError("Incomplete group catalogue")
    # Interleave institutions so the first batches cover the entire
    # university instead of spending days on a single high school.
    # The pilot remains first; every group still appears exactly once per loop.
    pilot=next((g for g in groups if str(g["id"])=="21096"),None)
    buckets={}
    for g in groups:
        if pilot and str(g["id"])==str(pilot["id"]):
            continue
        buckets.setdefault(str(g["institution_id"]),[]).append(g)
    for values in buckets.values():
        values.sort(key=lambda g:(g["number"].casefold(),g["id"]))
    ids=sorted(buckets,key=lambda x:(0,int(x)) if x.isdecimal() else (1,x))
    ordered=[pilot] if pilot else []
    while any(buckets.values()):
        for iid in ids:
            if buckets[iid]:
                ordered.append(buckets[iid].pop(0))
    groups=ordered
    start=int(cursor)%len(groups)
    return [groups[(start+i)%len(groups)] for i in range(min(limit,len(groups)))],(start+limit)%len(groups),len(groups)


# Failure retries are strictly bounded. One failure never blocks the main cursor.
RETRY_COOLDOWN_SECONDS = 6 * 3600
MAX_FAILURE_ATTEMPTS = 3  # first pass + at most two delayed retries

def select_with_retries(catalog, state, limit, now):
    """Reserve at most two slots for old failures; advance the main cursor."""
    failures = state.get("failures", {})
    if not isinstance(failures, dict):
        failures = {}
    by_id = {str(g["id"]): g for g in catalog.get("groups", [])}
    try:
        now_dt = datetime.fromisoformat(now.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        raise ValueError("Invalid synchronized timestamp")
    if now_dt.tzinfo is None:
        raise ValueError("Timestamp needs timezone")
    due = []
    for gid, item in failures.items():
        if gid not in by_id or not isinstance(item, dict):
            continue
        attempts = item.get("attempts", 0)
        when = item.get("last_failed_at", "")
        if not isinstance(attempts, int) or not 1 <= attempts < MAX_FAILURE_ATTEMPTS:
            continue
        try:
            failed_dt = datetime.fromisoformat(when.replace("Z", "+00:00"))
            if failed_dt.tzinfo is None or (now_dt - failed_dt).total_seconds() < RETRY_COOLDOWN_SECONDS:
                continue
        except (AttributeError, ValueError, TypeError):
            continue
        due.append((when, gid))
    due.sort()
    slots = min(2, limit // 4, len(due))
    fresh, next_cursor, total = selected(catalog, state.get("cursor", 0), limit - slots)
    already = {str(g["id"]) for g in fresh}
    retried = [by_id[gid] for _, gid in due if gid not in already][:slots]
    return fresh + retried, next_cursor, total, {str(g["id"]) for g in retried}

def collect(root,*,get=get_page,nap=time.sleep,limit=12,pause=1.6,clock=stamp):
    if not 1<=limit<=120 or not 1<=pause<=60:raise ValueError("Unsafe batch parameters")
    state=read(root/"data"/"sync_state.json",{}) or {}
    if not isinstance(state,dict):state={}
    now=clock()
    catalog=read(root/"catalog.json",{}) or {}
    batch,next_cursor,total,retried_ids=select_with_retries(catalog,state,limit,now)
    failures=state.get("failures",{})
    if not isinstance(failures,dict):failures={}
    valid_ids={str(g["id"]) for g in catalog["groups"]}
    failures={gid:item for gid,item in failures.items() if gid in valid_ids and isinstance(item,dict)}
    status={"checked_at":now,"groups_total":total,"groups_attempted":len(batch),
            "groups_ok":0,"groups_failed":0,"groups_empty":0,"errors":[],"source":"https://ruz.narfu.ru/",
            "retried_groups":len(retried_ids)}
    for i,group in enumerate(batch):
        if i:nap(pause)
        try:
            raw=get(str(group["id"]))
            if verified_empty_window(raw,group["number"]):
                status["groups_empty"]+=1
                failures.pop(str(group["id"]),None)
                print("EMPTY",group["number"],group["id"],flush=True)
                continue
            parsed=parse(raw,group["number"])
            store(root/"data",group,parsed,now)
            status["groups_ok"]+=1
            failures.pop(str(group["id"]),None)
            print("OK",group["number"],group["id"],len(parsed["lessons"]),flush=True)
        except (OSError,ValueError,RuntimeError) as exc:
            status["groups_failed"]+=1
            gid=str(group["id"])
            previous=failures.get(gid,{}) if gid in retried_ids else {}
            attempts=int(previous.get("attempts",0))+1
            failures[gid]={"attempts":attempts,"last_failed_at":now}
            status["errors"].append({"id":gid,"group":group["number"],
                                     "error":type(exc).__name__+": "+str(exc)[:120]})
            print("FAILED",group["number"],group["id"],str(exc)[:120],flush=True)
    state.update({"cursor":next_cursor,"last_run":now,"failures":failures})
    write(root/"data"/"sync_state.json",state)
    status["retry_pending"]=sum(isinstance(v.get("attempts"),int) and v["attempts"]<MAX_FAILURE_ATTEMPTS for v in failures.values())
    status["retry_exhausted"]=sum(isinstance(v.get("attempts"),int) and v["attempts"]>=MAX_FAILURE_ATTEMPTS for v in failures.values())
    sched=root/"data"/"schedules"
    ids=sorted(x.stem for x in sched.glob("*.json") if x.stem.isdecimal()) if sched.exists() else []
    status["cached_ids"]=ids
    status["groups_cached_total"]=len(ids)
    write(root/"data"/"status.json",status)
    return status


def collect_all(root, *, get=get_page, nap=time.sleep, clock=stamp, workers=3, min_interval=0.9):
    """Run a complete rate-limited pass from GitHub, never on the VPS.

    Three requests may be in flight, but starts are globally staggered to
    avoid bursts. Worker threads only download/parse; one coordinator commits
    validated snapshots. A bad response cannot delete a saved timetable.
    """
    if not 1 <= workers <= 3 or not 0.5 <= min_interval <= 10:
        raise ValueError("Unsafe full-scan concurrency or upstream rate")
    catalog = read(root / "catalog.json", {}) or {}
    if not isinstance(catalog, dict):
        raise ValueError("Invalid official catalogue")
    group_count = len(catalog.get("groups", []))
    batch, _, total = selected(catalog, 0, group_count)
    if len(batch) != total or total < 150:
        raise ValueError("Cannot verify complete university group catalogue")

    scan_started_at = clock()
    started = time.monotonic()
    next_at = [started]
    pacing = Lock()
    retries_remaining = FULL_SCAN_RETRY_LIMIT

    def paced_get(gid):
        # Allocate a non-overlapping request start slot under a short lock.
        # Never sleep while holding it: other workers can reserve later slots.
        with pacing:
            moment = time.monotonic()
            slot = max(moment, next_at[0])
            next_at[0] = slot + min_interval
        wait = slot - time.monotonic()
        if wait > 0:
            nap(wait)
        return get(gid)

    def fetch_one(group):
        nonlocal retries_remaining
        gid = str(group["id"])
        try:
            try:
                raw = paced_get(gid)
            except (URLError, *TRANSIENT_NETWORK_ERRORS) as exc:
                reason = exc.reason if isinstance(exc, URLError) else exc
                if not isinstance(reason, TRANSIENT_NETWORK_ERRORS):
                    raise
                with pacing:
                    if retries_remaining <= 0:
                        raise
                    retries_remaining -= 1
                raw = paced_get(gid)
            empty_dates = verified_empty_dates(raw, group["number"])
            if empty_dates:
                return group, "empty", empty_dates, None
            return group, "ok", parse(raw, group["number"]), None
        except (OSError, ValueError, RuntimeError) as exc:
            return group, "failed", None, type(exc).__name__ + ": " + str(exc)[:120]

    state = read(root / "data" / "sync_state.json", {}) or {}
    if not isinstance(state, dict):
        state = {}
    failures = {}
    report = {
        "source": BASE,
        "scan_started_at": scan_started_at,
        "groups_total": total,
        "groups_attempted": total,
        "groups_completed": 0,
        "groups_ok": 0,
        "groups_empty": 0,
        "groups_failed": 0,
        "groups_changed": 0,
        "empty_dates": {},
        "errors": [],
        "full_refresh": True,
        "scan_workers": workers,
    }
    # Keep the response inventory bounded: every failure ID is in
    # sync_state.json; status.json carries only a small diagnostic sample.
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="para-ruz") as executor:
        tasks = [executor.submit(fetch_one, group) for group in batch]
        for future in as_completed(tasks):
            group, outcome, parsed, error = future.result()
            gid = str(group["id"])
            if outcome == "ok":
                try:
                    changed = store(root / "data", group, parsed, clock())
                    report["groups_ok"] += 1
                    report["groups_changed"] += int(changed)
                    print("OK", group["number"], gid, len(parsed["lessons"]), flush=True)
                except (OSError, ValueError, RuntimeError) as exc:
                    outcome = "failed"
                    error = type(exc).__name__ + ": " + str(exc)[:120]
            if outcome == "empty":
                report["empty_dates"][gid] = parsed
                report["groups_empty"] += 1
                print("EMPTY", group["number"], gid, flush=True)
            elif outcome == "failed":
                report["groups_failed"] += 1
                failures[gid] = {"attempts": 1, "last_failed_at": clock()}
                if len(report["errors"]) < 25:
                    report["errors"].append({"id": gid, "group": group["number"], "error": error})
                print("FAILED", group["number"], gid, error, flush=True)
            report["groups_completed"] += 1
            if report["groups_completed"] % 50 == 0:
                print(
                    "PROGRESS", report["groups_completed"], "/", total,
                    "ok", report["groups_ok"], "empty", report["groups_empty"],
                    "failed", report["groups_failed"], flush=True,
                )

    report["checked_at"] = clock()
    report["scan_duration_seconds"] = round(time.monotonic() - started, 2)
    report["retry_pending"] = report["groups_failed"]
    report["retry_exhausted"] = 0
    report["source_status"] = (
        "degraded" if report["groups_failed"] > max(5, total // 10) else "checked"
    )
    if report["groups_ok"] + report["groups_empty"] + report["groups_failed"] != total:
        raise RuntimeError("Incomplete scan accounting; refusing publication")

    snapshots = root / "data" / "schedules"
    ids = sorted(p.stem for p in snapshots.glob("*.json") if p.stem.isdecimal()) if snapshots.exists() else []
    report["cached_ids"] = ids
    report["groups_cached_total"] = len(ids)

    # Never erase the current status on a total upstream outage. The job
    # must fail and leave previously published GitHub files untouched.
    if report["groups_ok"] == 0 and report["groups_failed"] > max(5, total // 10):
        raise RuntimeError("RUZ appears unavailable; retained all last verified snapshots")

    state.update({
        "cursor": 0, "last_run": report["checked_at"],
        "last_full_scan": report["checked_at"], "failures": failures,
    })
    write(root / "data" / "sync_state.json", state)
    write(root / "data" / "status.json", report)
    return report


if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",type=Path,default=Path("."))
    ap.add_argument("--limit",type=int,default=12)
    ap.add_argument("--pause",type=float,default=1.6)
    ap.add_argument("--all",action="store_true",help="Safely scan all official groups with global upstream pacing")
    ap.add_argument("--workers",type=int,default=3)
    ap.add_argument("--interval",type=float,default=0.9,help="Minimum seconds between upstream request starts")
    args=ap.parse_args()
    report=(collect_all(args.root,workers=args.workers,min_interval=args.interval)
            if args.all else collect(args.root,limit=args.limit,pause=args.pause))
    print(json.dumps(report,ensure_ascii=False,indent=2))
