"""Offline regression contract for PARA's independent TANDEM/Livewire adapter."""
import html
import json
import tempfile
import unittest
from pathlib import Path
from scripts import collect_tandem as tandem


GROUP = {"id": "20967", "number": "194601", "institution_id": "36"}
EVENT = {
    "group": "194601 (1)",
    "date": "23.11.2026",
    "startTime": "08:20",
    "endTime": "09:55",
    "discipline": "Математика",
    "groupType": "Практические занятия",
    "classroom": "414Б414Б",
    "teachers": [{"last_name": "Иванова", "first_name": "Анна", "middle_name": "Сергеевна"}],
    "address": "Основной",
}


class Adapter(unittest.TestCase):
    def test_parses_official_component_and_token(self):
        comp = {"fingerprint": {"name": "main-grid", "id": "unit"}, "serverMemo": {"data": {"events": {}}}}
        raw = '<html><script>var livewire_token = "fake-token-1234";</script><div wire:initial-data="' + html.escape(
            json.dumps(comp), quote=True
        ) + '"></div></html>'
        token, parsed = tandem.parse_bootstrap(raw)
        self.assertEqual(token, "fake-token-1234")
        self.assertEqual(parsed["fingerprint"]["name"], "main-grid")

    def test_correct_lesson_group_and_teacher(self):
        row = tandem.convert_event(EVENT, "194601")
        self.assertEqual(row["date"], "2026-11-23")
        self.assertEqual(row["teacher"], "Иванова А.С.")
        self.assertEqual(row["room"], "414Б")
        self.assertEqual(row["subgroup"], "1")
        self.assertEqual(row["lesson_type"], "Практическое занятие")
        with self.assertRaisesRegex(ValueError, "Wrong group"):
            tandem.convert_event(EVENT, "194602")

    def test_events_nested_in_response(self):
        payload = {"Доп_0": [EVENT, {"content": [dict(EVENT, date="24.11.2026")]}]}
        self.assertEqual(len(tandem.events_from(payload)), 2)

    def test_guard_prevents_replacing_ruz_even_if_tandem_is_newer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / "data" / "schedules" / "20967.json"
            tandem.write_json(destination, {
                "group_id": "20967", "group_number": "194601",
                "periods": [{"start": "2026-11-23", "end": "2026-11-23",
                             "lessons": [{"date": "2026-11-23", "subject": "Официальный РУЗ"}]}],
            })
            original = destination.read_bytes()
            self.assertFalse(tandem.save(root, GROUP, [EVENT], "2026-11-24T00:00:00Z"))
            self.assertEqual(original, destination.read_bytes())

    def test_tandem_reuses_prior_verified_record_if_new_window_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertTrue(tandem.save(root, GROUP, [EVENT], "2026-11-23T00:00:00Z"))
            file = root / "data" / "schedules" / "20967.json"
            original = file.read_bytes()
            self.assertFalse(tandem.save(root, GROUP, [], "2026-11-24T00:00:00Z"))
            self.assertEqual(file.read_bytes(), original)

    def test_only_official_fishing_school_1946_groups_selected(self):
        catalog = {"groups": [
            GROUP,
            {"id": "21096", "number": "171605", "institution_id": "28"},
            {"id": "20479", "number": "524502", "institution_id": "23"},
            {"id": "20964", "number": "194604", "institution_id": "36"},
        ]}
        self.assertEqual([g["id"] for g in tandem.pick_groups(catalog)], ["20967", "20964"])

    def test_collection_with_isolated_fake_livewire_state(self):
        class Fake:
            def open(self): pass
            def call(self, method, args=None):
                return {"events": {"lesson": [EVENT]}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tandem.write_json(root / "catalog.json", {"groups": [GROUP]})
            result = tandem.collect(root, groups_limit=1, weeks=2, pause=1, session_factory=Fake)
            self.assertEqual(result["errors"], [])
            self.assertEqual(result["with_lessons"], 1)
            self.assertEqual(result["published"], 1)
            doc = tandem.read_json(root / "data" / "schedules" / "20967.json")
            self.assertEqual(doc["source_provider"], "ttt.narfu.ru")
            self.assertEqual(len(doc["periods"][0]["lessons"]), 1)


if __name__ == "__main__":
    unittest.main()
