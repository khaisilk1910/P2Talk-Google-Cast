"""Non-blocking registration of the P2Talk Lovelace card resource.

Only the integration-owned URL is touched, and only when Home Assistant
manages Lovelace resources in storage mode. YAML resource configuration is
never modified. Registration runs after HA startup, not in setup_entry.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from urllib.parse import urlsplit

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)
CARD_RESOURCE_PATH = f"/{DOMAIN}_assets/cards.js"


def _integration_version() -> str:
    """Match the resource cache-busting version to the installed manifest."""
    manifest = Path(__file__).with_name("manifest.json")
    return json.loads(manifest.read_text(encoding="utf-8"))["version"]


def _is_our_resource(url: object) -> bool:
    """Match only our local static path (including old non-versioned URLs)."""
    if not isinstance(url, str):
        return False
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    return not parsed.scheme and not parsed.netloc and parsed.path == CARD_RESOURCE_PATH


async def async_register_card_resource(hass) -> None:
    """Idempotently register the JS module through Lovelace's storage API.

    Explicitly ensure the resource collection is loaded before reading or
    mutating it. Older Home Assistant Core versions could lose the user's
    existing resources if async_create_item was called on an unloaded list.
    """
    # Quick reloads or repeated setup attempts must not race into duplicate
    # creates. Scope the lock to this Home Assistant instance, not globally.
    lock = hass.data.setdefault(f"{DOMAIN}_resource_registration_lock", asyncio.Lock())
    async with lock:
        await _async_register_card_resource_unlocked(hass)


async def _async_register_card_resource_unlocked(hass) -> None:
    """Register once, under the Home Assistant instance's resource lock."""
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        _LOGGER.warning("Lovelace not available; P2Talk card resource was not registered")
        return

    resource_mode = getattr(lovelace, "resource_mode", getattr(lovelace, "mode", "storage"))
    if resource_mode != "storage":
        _LOGGER.info("Lovelace resources use YAML; P2Talk did not alter user configuration")
        return

    resources = lovelace.resources
    try:
        # async_get_info() safely triggers lazy loading of older collections.
        # Never call async_items()/async_create_item() on an unloaded collection.
        if not getattr(resources, "loaded", False):
            await resources.async_get_info()
        if not getattr(resources, "loaded", False):
            _LOGGER.error("Lovelace resources are not loaded; refusing to write resource storage")
            return

        current_url = f"{CARD_RESOURCE_PATH}?v={_integration_version()}"
        existing = [
            item for item in resources.async_items()
            if _is_our_resource(item.get("url"))
        ]
        if existing:
            # Keep the original ID, so upgrades from v1.3.0 or later do not
            # produce duplicate Resources entries. Do not touch other cards.
            item = next((entry for entry in existing if entry.get("type") == "module"), existing[0])
            if item.get("url") != current_url or item.get("type") != "module":
                await resources.async_update_item(
                    item["id"], {"url": current_url, "res_type": "module"}
                )
                _LOGGER.info("Updated P2Talk Lovelace card resource")
            if len(existing) > 1:
                _LOGGER.warning(
                    "Multiple P2Talk card Resources found; kept existing entries to avoid "
                    "changing user configuration. Review duplicate entries in Resources."
                )
            return

        await resources.async_create_item({"url": current_url, "res_type": "module"})
        _LOGGER.info("Automatically registered P2Talk Lovelace cards in Resources")
    except Exception:  # noqa: BLE001 - a resource failure must not break the backend
        _LOGGER.exception("Failed to register P2Talk card resource; other Resources unchanged")
