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
    def test_dotted_group(self):
        self.assertEqual(len(collector.parse(sample("1.5.15"),"1.5.15")["lessons"]),3)
    def test_wrong_group_rejected(self):
        with self.assertRaises(ValueError):collector.parse(sample(),"171604")
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

if __name__=="__main__":
    unittest.main()
