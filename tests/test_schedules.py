import importlib.util, json, tempfile, unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location("collect_schedules",Path(__file__).resolve().parents[1]/"scripts"/"collect_schedules.py")
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

def sample(number="171605"):
    return f"""<html><h1>Группа {number}</h1>
    <h2>четверг, 19.11.2026</h2>
    <p>1 08:20–09:55 Практическое занятие Иностранный язык ( Соколова М.Л. ) Поток "ИЯ_Немецкий_02" ауд. 428, пр. Ломоносова, д. 4</p>
    <p>1 08:20–09:55 Практическое занятие Иностранный язык (Жемчугова С.А.) Поток "ВШЭУиП_№12" ауд. 418, пр. Ломоносова, д. 4</p>
    <h2>пятница, 20.11.2026</h2>
    <p>3 12:00–13:35 Лекция История и философия (подготовка к экзамену) (Опенков М.Ю.) ауд. 211, наб. Северной Двины, д. 17</p></html>"""

class Safety(unittest.TestCase):
    def test_full_scan_retries_disconnect_once(self):
        from http.client import RemoteDisconnected

        groups = [
            {"id": str(23000 + i), "number": str(100000 + i), "institution_id": "28"}
            for i in range(150)
        ]
        calls = {"23000": 0, "23001": 0}

        def get(gid):
            if gid in calls:
                calls[gid] += 1
                if gid == "23001" or calls[gid] == 1:
                    raise RemoteDisconnected("test disconnect")
            return sample(groups[int(gid) - 23000]["number"])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collector.write(root / "catalog.json", {"groups": groups})
            report = collector.collect_all(root, get=get, nap=lambda _: None)
            self.assertEqual(calls, {"23000": 2, "23001": 2})
            self.assertEqual(report["groups_completed"], 150)
            self.assertEqual(report["groups_ok"], 149)
            self.assertEqual(report["groups_failed"], 1)
            self.assertEqual(report["errors"][0]["id"], "23001")

    def test_streams_teacher_and_parentheses(self):
        p=collector.parse(sample(),"171605")
        self.assertEqual(len(p["lessons"]),3)
        self.assertEqual(len({x["stream"] for x in p["lessons"] if x["stream"]}),2)
        self.assertIn("Соколова М.Л.",[x["teacher"] for x in p["lessons"]])
        self.assertTrue(any("(подготовка к экзамену)" in x["subject"] for x in p["lessons"]))
    def test_known_ruz_oddities(self):
        html=sample().replace("Лекция История", "Дифференцированный зачет История")
        html=html.replace("наб. Северной Двины, д. 17", "наб. Северной Двины, д. 17 3 4")
        parsed=collector.parse(html,"171605")
        special=[x for x in parsed["lessons"] if x["lesson_type"]=="Дифференцированный зачет"]
        self.assertEqual(len(special),1)
        self.assertEqual(special[0]["address"],"наб. Северной Двины, д. 17")
    def test_curator_hour_type(self):
        html=sample().replace("Лекция История", "Кураторский час История")
        parsed=collector.parse(html,"171605")
        self.assertEqual(len([x for x in parsed["lessons"] if x["lesson_type"]=="Кураторский час"]),1)
    def test_dotted_group(self):
        self.assertEqual(len(collector.parse(sample("1.5.15"),"1.5.15")["lessons"]),3)
    def test_wrong_group_rejected(self):
        with self.assertRaises(ValueError):collector.parse(sample(),"171604")
    def test_real_narfu_practice_and_repeated_attestation_types(self):
        # Type labels observed in failed verified RUZ sync batches.
        examples=(
            ("Практика", "Учебная ознакомительная практика, психолого-педагогический практикум"),
            ("Практические занятия (Практическая подготовка)", "ВУЦ"),
            ("Вторая повторная промежуточная аттестация (комиссия)", "Математическая статистика"),
            ("Первая повторная промежуточная аттестация", "История российско-американских отношений"),
        )
        for lesson_type,subject in examples:
            with self.subTest(lesson_type=lesson_type):
                html=sample("521505").replace("Лекция История и философия",lesson_type+" "+subject)
                result=collector.parse(html,"521505")
                matching=[l for l in result["lessons"] if l["subject"].startswith(subject)]
                self.assertEqual(len(matching),1)
                self.assertEqual(matching[0]["lesson_type"],lesson_type)
                self.assertEqual(matching[0]["teacher"],"Опенков М.Ю.")

    def test_official_diagnostic_testing_is_not_discarded(self):
        page=sample("161605").replace("Лекция История и философия", "Диагностическое тестирование Диагностика профессионального самоопределения студента")
        result=collector.parse(page,"161605")
        pairs=[row for row in result["lessons"] if row["lesson_type"]=="Диагностическое тестирование"]
        self.assertEqual(len(pairs),1)
        self.assertIn("Диагностика профессионального",pairs[0]["subject"])

    def test_unknown_lesson_rejected(self):
        with self.assertRaisesRegex(ValueError,"Unknown lesson type"):
            collector.parse(sample().replace("Лекция История","Неизвестно История"),"171605")
    def test_last_snapshot_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            group={"id":"21096","number":"171605","institution_id":"28"}
            p=collector.parse(sample(),"171605")
            self.assertTrue(collector.store(root,group,p,"2026-11-19T00:00:00Z"))
            original=(root/"schedules"/"21096.json").read_bytes()
            self.assertFalse(collector.store(root,group,p,"2026-11-20T00:00:00Z"))
            self.assertEqual(original,(root/"schedules"/"21096.json").read_bytes())
            with self.assertRaises(ValueError):
                collector.store(root,{**group,"number":"171604"},p,"now")
            self.assertEqual(original,(root/"schedules"/"21096.json").read_bytes())
    def test_catalogue_scans_across_schools_not_only_first_school(self):
        groups=[{"id":str(20000+i),"number":str(100000+i),
                 "institution_id":str((i//30)+1)} for i in range(150)]
        groups.append({"id":"21096","number":"171605","institution_id":"28"})
        batch, cursor, total=collector.selected({"groups":groups},0,14)
        self.assertEqual(total,151)
        self.assertEqual(cursor,14)
        self.assertEqual(batch[0]["id"],"21096")
        self.assertGreaterEqual(len({g["institution_id"] for g in batch}),5)
        self.assertEqual(len({g["id"] for g in batch}),14)
        second, _, _=collector.selected({"groups":groups},14,14)
        self.assertFalse({g["id"] for g in batch}&{g["id"] for g in second})

    def test_cursor_and_failure_isolation(self):
        groups=[{"id":str(21000+i),"number":str(100000+i),"institution_id":"28"} for i in range(160)]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            collector.write(root/"catalog.json",{"groups":groups})
            calls=[]
            def get(gid):
                calls.append(gid)
                if gid==groups[0]["id"]:raise ValueError("temporary failure")
                return sample(groups[int(gid)-21000]["number"])
            out=collector.collect(root,get=get,nap=lambda _:None,limit=3,pause=1,clock=lambda:"2026-11-20T00:00:00Z")
            self.assertEqual((out["groups_ok"],out["groups_failed"]),(2,1))
            self.assertEqual(out["groups_cached_total"],2)
            self.assertEqual(collector.read(root/"data"/"sync_state.json")["cursor"],3)
            self.assertEqual(len(calls),3)
    def test_truncated_source_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            group={"id":"21096","number":"171605"}
            parsed=collector.parse(sample(),"171605")
            collector.store(root,group,parsed,"now")
            saved=collector.read(root/"schedules"/"21096.json")
            saved["periods"][0]["lessons"]*=7
            collector.write(root/"schedules"/"21096.json",saved)
            with self.assertRaisesRegex(ValueError,"Incomplete source"):
                collector.store(root,group,parsed,"later")

    def test_failed_group_retried_after_cooldown(self):
        groups=[{"id":str(21000+i),"number":str(100000+i),"institution_id":"28"} for i in range(160)]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            collector.write(root/"catalog.json",{"groups":groups})
            calls={}
            def get(gid):
                calls[gid]=calls.get(gid,0)+1
                if gid=="21000" and calls[gid]==1:
                    raise ValueError("temporary upstream error")
                return sample(groups[int(gid)-21000]["number"])
            def run(at):
                return collector.collect(root,get=get,nap=lambda _:None,limit=4,pause=1,clock=lambda:at)
            initial=run("2026-11-20T00:00:00+00:00")
            self.assertEqual((initial["groups_ok"],initial["groups_failed"]),(3,1))
            state=collector.read(root/"data"/"sync_state.json")
            self.assertEqual(state["cursor"],4)
            self.assertEqual(state["failures"]["21000"]["attempts"],1)
            too_soon=run("2026-11-20T02:00:00+00:00")
            self.assertEqual(too_soon["retried_groups"],0)
            self.assertEqual(calls["21000"],1)
            self.assertEqual(collector.read(root/"data"/"sync_state.json")["cursor"],8)
            later=run("2026-11-20T07:00:00+00:00")
            self.assertEqual(later["retried_groups"],1)
            self.assertEqual((later["groups_ok"],later["groups_failed"]),(4,0))
            self.assertEqual(calls["21000"],2)
            state=collector.read(root/"data"/"sync_state.json")
            self.assertEqual(state["cursor"],11)
            self.assertNotIn("21000",state["failures"])
            self.assertEqual(later["retry_pending"],0)

    def test_retry_cap_never_blocks_new_groups(self):
        groups=[{"id":str(21000+i),"number":str(100000+i),"institution_id":"28"} for i in range(160)]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            collector.write(root/"catalog.json",{"groups":groups})
            calls={}
            def get(gid):
                calls[gid]=calls.get(gid,0)+1
                if gid=="21000": raise ValueError("no published timetable")
                return sample(groups[int(gid)-21000]["number"])
            def run(at):
                return collector.collect(root,get=get,nap=lambda _:None,limit=4,pause=1,clock=lambda:at)
            run("2026-11-20T00:00:00Z")
            a=run("2026-11-20T07:00:00Z")
            b=run("2026-11-20T14:00:00Z")
            c=run("2026-11-20T21:00:00Z")
            self.assertEqual((a["retried_groups"],b["retried_groups"],c["retried_groups"]),(1,1,0))
            self.assertEqual(calls["21000"],3)
            self.assertEqual(collector.read(root/"data"/"sync_state.json")["failures"]["21000"]["attempts"],3)
            self.assertEqual(c["retry_exhausted"],1)


    def test_unnumbered_slots_and_additional_ruz_activity_types(self):
        html = sample().replace("1 08:20–09:55", "08:20–09:55")
        html = html.replace("Лекция История", "Контрольная работа История")
        result = collector.parse(html, "171605")
        self.assertEqual(len(result["lessons"]), 3)
        self.assertEqual(sum(x["start"] == "08:20:00" for x in result["lessons"]), 2)
        self.assertEqual(result["lessons"][2]["lesson_type"], "Контрольная работа")

    def test_official_empty_window_requires_same_group_and_no_lesson_slots(self):
        html = (
            '<html><h1>Группа 524503</h1>'
            '<h3>понедельник, 23.11.2026</h3>'
            '<h3>вторник, 24.11.2026</h3>'
            '<p>Данные о расписании на эту неделю отсутствуют в системе.</p></html>'
        )
        self.assertTrue(collector.verified_empty_window(html, "524503"))
        self.assertFalse(collector.verified_empty_window(html, "524504"))
        suspicious = html.replace(
            "</html>",
            '<p>08:20–09:55 Неизвестный тип Тест ауд. 101</p></html>',
        )
        self.assertFalse(collector.verified_empty_window(suspicious, "524503"))
        with self.assertRaises(ValueError):
            collector.parse(suspicious, "524503")

    def test_empty_window_is_counted_and_does_not_erase_saved_copy(self):
        groups = [
            {"id": str(22000+i), "number": str(100000+i), "institution_id": "28"}
            for i in range(160)
        ]
        empty_group = groups[0]
        empty_html = (
            '<html><h1>Группа 100000</h1>'
            '<h3>понедельник, 23.11.2026</h3>'
            '<p>Данные о расписании на эту неделю отсутствуют в системе.</p></html>'
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collector.write(root/"catalog.json", {"groups": groups})
            old = collector.parse(sample("100000"), "100000")
            collector.store(root/"data", empty_group, old, "2026-11-19T00:00:00Z")
            original = (root/"data"/"schedules"/"22000.json").read_bytes()

            def get(gid):
                return empty_html if gid == "22000" else sample(groups[int(gid)-22000]["number"])
            report = collector.collect(
                root, get=get, nap=lambda _: None, limit=6, pause=1,
                clock=lambda: "2026-11-20T18:00:00Z",
            )
            self.assertEqual(report["groups_empty"], 1)
            self.assertEqual(report["groups_ok"], 5)
            self.assertEqual(report["groups_failed"], 0)
            self.assertEqual(original, (root/"data"/"schedules"/"22000.json").read_bytes())
            self.assertNotIn("22000", collector.read(root/"data"/"sync_state.json")["failures"])

    def test_full_backfill_covers_every_catalog_id_once_before_wrap(self):
        groups = [
            {"id": str(23000+i), "number": str(100000+i), "institution_id": str(i%13+1)}
            for i in range(876)
        ]
        cursor = 0
        seen = set()
        for _ in range(7):
            items, cursor, count = collector.selected({"groups":groups}, cursor, 120)
            self.assertEqual(count, 876)
            self.assertFalse(seen & {g["id"] for g in items})
            seen.update(g["id"] for g in items)
        items, cursor, count = collector.selected({"groups":groups}, cursor, 36)
        self.assertEqual(count, 876)
        self.assertFalse(seen & {g["id"] for g in items})
        seen.update(g["id"] for g in items)
        self.assertEqual(len(seen), 876)
        self.assertEqual(cursor, 0)


    def test_full_parallel_scan_verifies_every_group_and_preserves_empty_previous(self):
        groups=[
            {"id":str(23000+i), "number":str(100000+i), "institution_id":str(i%14+1)}
            for i in range(160)
        ]
        group_by_id={g["id"]:g for g in groups}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            collector.write(root/"catalog.json",{"groups":groups})
            existing=collector.parse(sample(groups[1]["number"]),groups[1]["number"])
            collector.store(root/"data",groups[1],existing,"2026-11-18T00:00:00+00:00")
            original=(root/"data"/"schedules"/(groups[1]["id"]+".json")).read_bytes()
            from threading import Lock
            from time import sleep
            monitor=Lock()
            active=[0]
            maximum=[0]
            visited=[]
            def get(gid):
                with monitor:
                    visited.append(gid)
                    active[0]+=1
                    maximum[0]=max(maximum[0],active[0])
                try:
                    sleep(0.0005)
                    group=group_by_id[gid]
                    if gid==groups[1]["id"]:
                        return ('<html><h1>Группа '+group["number"]+'</h1>'
                                '<h2>понедельник, 23.11.2026</h2>'
                                '<p>Данные о расписании на эту неделю отсутствуют в системе.</p></html>')
                    if gid==groups[2]["id"]:
                        raise OSError("transient upstream disconnect")
                    return sample(group["number"])
                finally:
                    with monitor:
                        active[0]-=1
            out=collector.collect_all(
                root,get=get,nap=lambda _:None,workers=3,min_interval=0.5,
                clock=lambda:"2026-11-21T00:00:00+00:00",
            )
            self.assertEqual((out["groups_total"],out["groups_completed"]), (160,160))
            self.assertEqual((out["groups_ok"],out["groups_empty"],out["groups_failed"]),(158,1,1))
            self.assertEqual(out["groups_changed"],158)
            self.assertEqual(out["empty_dates"], {groups[1]["id"]: ["2026-11-23"]})
            self.assertEqual(len(set(visited)),160)
            self.assertEqual(len(visited),160)
            self.assertTrue(1<=maximum[0]<=3)
            self.assertEqual(original,(root/"data"/"schedules"/(groups[1]["id"]+".json")).read_bytes())
            self.assertEqual(out["groups_cached_total"],159)
            state=collector.read(root/"data"/"sync_state.json")
            self.assertEqual(set(state["failures"]),{groups[2]["id"]})
            self.assertEqual(state["cursor"],0)
            self.assertEqual(out["full_refresh"],True)

    def test_full_scan_rejects_total_source_outage_and_keeps_published_status(self):
        groups=[
            {"id":str(23000+i), "number":str(100000+i), "institution_id":str(i%14+1)}
            for i in range(150)
        ]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            collector.write(root/"catalog.json",{"groups":groups})
            collector.write(root/"data"/"status.json",{"groups_cached_total":99,"checked_at":"previous"})
            def broken(_):
                raise OSError("official source unavailable")
            with self.assertRaisesRegex(RuntimeError,"RUZ appears unavailable"):
                collector.collect_all(root,get=broken,nap=lambda _:None,workers=2,
                    min_interval=0.5,clock=lambda:"2026-11-21T00:00:00+00:00")
            self.assertEqual(collector.read(root/"data"/"status.json")["checked_at"],"previous")

    def test_full_scan_enforces_upstream_concurrency_and_rate_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with self.assertRaisesRegex(ValueError,"Unsafe"):
                collector.collect_all(root,workers=8)
            with self.assertRaisesRegex(ValueError,"Unsafe"):
                collector.collect_all(root,min_interval=0)

if __name__=="__main__":
    unittest.main()
