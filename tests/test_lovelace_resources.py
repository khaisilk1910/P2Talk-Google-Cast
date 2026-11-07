"""Validate safe automatic Lovelace Resource enrollment without HA runtime."""

from __future__ import annotations

import asyncio
import importlib
import json
import sys
import types
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "p2talk_google_cast"
VERSION = json.loads((COMPONENT / "manifest.json").read_text(encoding="utf-8"))["version"]
# Offline tests emulate the HA loader, which already holds manifest metadata.
loader = types.ModuleType("homeassistant.loader")
async def cached_integration(hass, domain):
    assert domain == "p2talk_google_cast"
    return types.SimpleNamespace(version=getattr(hass, "manifest_version", VERSION))
loader.async_get_integration = cached_integration
sys.modules.setdefault("homeassistant.loader", loader)
pkg = sys.modules.setdefault("p2talk_google_cast", types.ModuleType("p2talk_google_cast"))
pkg.__path__ = [str(COMPONENT)]
registrar = importlib.import_module("p2talk_google_cast.lovelace_resources")


class FakeResources:
    def __init__(self, disk=None, *, loaded=False, can_load=True):
        self.loaded = loaded
        self.disk = [dict(i) for i in (disk or [])]
        self.items = [dict(i) for i in self.disk] if loaded else []
        self.can_load = can_load
        self.created = []
        self.updated = []
        self.loads = 0

    async def async_get_info(self):
        self.loads += 1
        if self.can_load:
            self.items = [dict(i) for i in self.disk]
            self.loaded = True
        return {"resources": len(self.items)}

    def async_items(self):
        assert self.loaded, "Reading unloaded Lovelace resources can destroy user data"
        return self.items

    async def async_create_item(self, info):
        assert self.loaded, "Never create on unloaded resource storage"
        item = {**info, "type": info["res_type"], "id": "new-card-resource"}
        self.items.append(item)
        self.created.append(info)

    async def async_update_item(self, item_id, fields):
        assert self.loaded, "Never update on unloaded resource storage"
        self.updated.append((item_id, fields))
        for item in self.items:
            if item["id"] == item_id:
                item.update({"url": fields["url"], "type": fields["res_type"]})
                return
        raise ValueError("missing resource")


def mock_hass(resources, mode="storage", *, version=VERSION):
    data = {"lovelace": types.SimpleNamespace(resource_mode=mode, resources=resources)}
    return types.SimpleNamespace(data=data, manifest_version=version)


class LovelaceResourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_register_while_storage_unloaded_preserves_other_cards(self):
        other = {"id": "keep-this", "url": "/hacsfiles/other-card/card.js", "type": "module"}
        collection = FakeResources([other])
        await registrar.async_register_card_resource(mock_hass(collection))
        self.assertEqual(collection.loads, 1)
        self.assertEqual(collection.items[0], other)
        self.assertEqual(len(collection.created), 1)
        self.assertEqual(len(collection.items), 2)
        self.assertEqual(collection.items[1]["url"], f"/p2talk_google_cast_assets/cards.js?v={VERSION}")
        self.assertEqual(collection.items[1]["type"], "module")


    async def test_version_comes_from_cached_ha_manifest_not_disk(self):
        resources = FakeResources(loaded=True)
        hass = mock_hass(resources, version="3.7.9")
        await registrar.async_register_card_resource(hass)
        self.assertEqual(resources.created[0]["url"],
                         "/p2talk_google_cast_assets/cards.js?v=3.7.9")
        self.assertEqual(hass.data["p2talk_google_cast_lovelace_resource_status"], {
            "result": "registered",
            "url": "/p2talk_google_cast_assets/cards.js?v=3.7.9",
        })

    async def test_registration_error_is_nonfatal_and_diagnostic(self):
        from unittest.mock import patch
        resources = FakeResources([{"id": "other", "url": "/local/other.js", "type": "module"}], loaded=True)
        hass = mock_hass(resources)
        async def broken_loader(_hass, _domain):
            raise RuntimeError("loader error")
        with patch.object(registrar, "async_get_integration", broken_loader):
            await registrar.async_register_card_resource(hass)
        self.assertEqual(len(resources.items), 1)
        self.assertEqual(hass.data["p2talk_google_cast_lovelace_resource_status"]["result"], "failed")
        self.assertEqual(resources.created, [])
        self.assertEqual(resources.updated, [])

    async def test_yaml_has_explicit_diagnostic_status(self):
        hass = mock_hass(FakeResources(), "yaml")
        await registrar.async_register_card_resource(hass)
        self.assertEqual(hass.data["p2talk_google_cast_lovelace_resource_status"]["result"], "yaml_mode")

    async def test_current_resource_is_stable_without_extra_storage_writes(self):
        resources = FakeResources(loaded=True)
        hass = mock_hass(resources)
        await registrar.async_register_card_resource(hass)
        await registrar.async_register_card_resource(hass)
        self.assertEqual(hass.data["p2talk_google_cast_lovelace_resource_status"]["result"], "already_registered")
        self.assertEqual(len(resources.created), 1)
        self.assertEqual(len(resources.updated), 0)

    async def test_idempotent_after_restart_and_double_registration(self):
        collection = FakeResources(loaded=True)
        hass = mock_hass(collection)
        await registrar.async_register_card_resource(hass)
        await registrar.async_register_card_resource(hass)
        self.assertEqual(len(collection.created), 1)
        self.assertEqual(len(collection.items), 1)
        self.assertEqual(collection.updated, [])
        self.assertEqual(collection.loads, 0)

    async def test_concurrent_registers_cannot_create_duplicates(self):
        collection = FakeResources(loaded=True)
        hass = mock_hass(collection)
        await asyncio.gather(*(registrar.async_register_card_resource(hass) for _ in range(8)))
        self.assertEqual(len(collection.created), 1)
        self.assertEqual(len(collection.items), 1)

    async def test_upgrade_reuses_manual_v13_resource_id(self):
        previous = {"id": "manual-existing-id", "url": "/p2talk_google_cast_assets/cards.js", "type": "module"}
        other = {"id": "someone-else", "url": "/local/another.js", "type": "module"}
        collection = FakeResources([previous, other])
        await registrar.async_register_card_resource(mock_hass(collection))
        self.assertEqual(collection.created, [])
        self.assertEqual(collection.updated, [("manual-existing-id", {
            "url": f"/p2talk_google_cast_assets/cards.js?v={VERSION}", "res_type": "module",
        })])
        self.assertEqual(len(collection.items), 2)
        self.assertEqual(collection.items[1], other)

    async def test_yaml_mode_never_mutates(self):
        collection = FakeResources(loaded=False)
        await registrar.async_register_card_resource(mock_hass(collection, "yaml"))
        self.assertFalse(collection.loaded)
        self.assertEqual(collection.loads, 0)
        self.assertFalse(collection.created or collection.updated)

    async def test_no_lovelace_is_safe(self):
        await registrar.async_register_card_resource(types.SimpleNamespace(data={}))

    async def test_fail_closed_when_collection_cannot_load(self):
        collection = FakeResources([{"id": "important", "url": "/other.js", "type": "module"}], can_load=False)
        await registrar.async_register_card_resource(mock_hass(collection))
        self.assertEqual(collection.loads, 1)
        self.assertEqual(collection.created, [])
        self.assertEqual(collection.updated, [])

    async def test_external_url_with_matching_path_is_not_ours(self):
        external = {"id": "external", "url": "https://example.com/p2talk_google_cast_assets/cards.js", "type": "module"}
        collection = FakeResources([external], loaded=True)
        await registrar.async_register_card_resource(mock_hass(collection))
        self.assertEqual(len(collection.items), 2)
        self.assertEqual(collection.items[0], external)
        self.assertEqual(collection.updated, [])

    async def test_manual_js_resource_is_upgraded_to_module(self):
        old = {"id": "old", "url": "/p2talk_google_cast_assets/cards.js?v=0", "type": "js"}
        collection = FakeResources([old], loaded=True)
        await registrar.async_register_card_resource(mock_hass(collection))
        self.assertEqual(collection.items[0]["type"], "module")
        self.assertEqual(len(collection.created), 0)

    async def test_never_change_duplicate_unrelated_resource(self):
        collection = FakeResources([
            {"id": "one", "url": "/p2talk_google_cast_assets/cards.js", "type": "module"},
            {"id": "two", "url": "/p2talk_google_cast_assets/cards.js?v=1.3.0", "type": "module"},
            {"id": "third", "url": "/local/something.js", "type": "module"},
        ], loaded=True)
        await registrar.async_register_card_resource(mock_hass(collection))
        self.assertEqual(len(collection.items), 3)
        self.assertEqual(collection.items[2]["url"], "/local/something.js")
        self.assertEqual(len(collection.created), 0)


if __name__ == "__main__":
    unittest.main()
