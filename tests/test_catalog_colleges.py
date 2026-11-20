"""Official independent college index remains in the main catalog."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("collect_catalog", Path(__file__).resolve().parents[1] / "scripts" / "collect_catalog.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class CollegeCatalog(unittest.TestCase):
    def test_peter_i_official_college_is_discovered_even_when_not_on_homepage(self):
        root = "".join('<a href="/?groups=&institution={}">Высшая школа {}</a>'.format(n, n) for n in range(1, 14))
        def get(url):
            if url == mod.ROOT:
                return root
            from urllib.parse import parse_qs, urlsplit
            iid = parse_qs(urlsplit(url).query)["institution"][0]
            if iid == "21":
                return '<a href="/?group=29999&timetable=">184501 Электротехника</a>'
            return "".join('<a href="/?group={}&timetable=">{} Направление</a>'.format(21000 + int(iid) * 20 + j, 100000 + int(iid) * 20 + j) for j in range(12))
        result = mod.collect(get=get, nap=lambda _: None)
        self.assertEqual(len(result["institutions"]), 14)
        self.assertEqual(len(result["groups"]), 157)
        group = next(g for g in result["groups"] if g["id"] == "29999")
        self.assertEqual((group["number"], group["institution_id"]), ("184501", "21"))
        self.assertTrue(any(s["id"] == "21" for s in result["institutions"]))


if __name__ == "__main__":
    unittest.main()
