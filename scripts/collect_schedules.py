"""PARA: bounded, incremental SAFU timetable publisher.
Only complete positive responses replace cached group JSON; no mass crawling.
"""
from __future__ import annotations
import argparse, json, os, re, time
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

BASE = "https://ruz.narfu.ru/"
MAX = 5_000_000
DAY = re.compile(r"(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье),?\s+(\d{1,2})\.(\d{2})\.(\d{4})",re.I)
PAIR = re.compile(r"(?<!\d)([1-9])\s+(\d{1,2}):(\d{2})\s*[—–-]\s*(\d{1,2}):(\d{2})\s+")
GROUP = re.compile(r"\b(?:Группа|гр\.)\s*[:№#-]?\s*([0-9А-ЯA-Z](?:[0-9А-ЯA-Z_.-]{1,38}[0-9А-ЯA-Z]))",re.I)
TYPES = sorted(("Практическое занятие","Лабораторная работа","Лекция","Семинар","Экзамен","Зачет","Зачёт","Дифференцированный зачет","Дифференцированный зачёт","Консультация","Собрание","Кураторский час","Курсовая работа","Курсовой проект","Федеральный интернет-экзамен (ФЭПО)","Федеральный интернет-экзамен"),key=len,reverse=True)
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
    groups=sorted(groups,key=lambda g:(0 if g["id"]=="21096" else 1 if g["institution_id"]=="28" else 2,g["number"].casefold(),g["id"]))
    start=int(cursor)%len(groups)
    return [groups[(start+i)%len(groups)] for i in range(min(limit,len(groups)))],(start+limit)%len(groups),len(groups)

def collect(root,*,get=get_page,nap=time.sleep,limit=12,pause=1.6,clock=stamp):
    if not 1<=limit<=30 or not 1<=pause<=60:raise ValueError("Unsafe batch parameters")
    state=read(root/"data"/"sync_state.json",{})
    batch,next_cursor,total=selected(read(root/"catalog.json",{}),state.get("cursor",0),limit)
    now=clock()
    status={"checked_at":now,"groups_total":total,"groups_attempted":len(batch),
            "groups_ok":0,"groups_failed":0,"errors":[],"source":"https://ruz.narfu.ru/"}
    for i,group in enumerate(batch):
        if i:nap(pause)
        try:
            parsed=parse(get(group["id"]),group["number"])
            store(root/"data",group,parsed,now)
            status["groups_ok"]+=1
            print("OK",group["number"],group["id"],len(parsed["lessons"]),flush=True)
        except (OSError,ValueError,RuntimeError) as exc:
            status["groups_failed"]+=1
            status["errors"].append({"id":group["id"],"group":group["number"],
                                     "error":type(exc).__name__+": "+str(exc)[:120]})
            print("FAILED",group["number"],group["id"],str(exc)[:120],flush=True)
    write(root/"data"/"sync_state.json",{"cursor":next_cursor,"last_run":now})
    sched=root/"data"/"schedules"
    ids=sorted(x.stem for x in sched.glob("*.json") if x.stem.isdecimal()) if sched.exists() else []
    status["cached_ids"]=ids
    status["groups_cached_total"]=len(ids)
    write(root/"data"/"status.json",status)
    return status

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",type=Path,default=Path("."))
    ap.add_argument("--limit",type=int,default=12)
    ap.add_argument("--pause",type=float,default=1.6)
    args=ap.parse_args()
    print(json.dumps(collect(args.root,limit=args.limit,pause=args.pause),ensure_ascii=False,indent=2))
