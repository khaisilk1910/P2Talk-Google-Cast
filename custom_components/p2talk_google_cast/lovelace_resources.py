"""Idempotent, post-startup enrollment of the P2Talk Lovelace module.

Never perform blocking file I/O on Home Assistant's event loop. The loader has
already read and cached the manifest before async_setup_entry is called.
Only the integration-owned URL is touched in Lovelace storage mode.
"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlsplit

from homeassistant.loader import async_get_integration

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)
CARD_RESOURCE_PATH = f"/{DOMAIN}_assets/cards.js"
_STATUS_KEY = f"{DOMAIN}_lovelace_resource_status"
_LOCK_KEY = f"{DOMAIN}_resource_registration_lock"


def _status(hass, result: str, *, url: str | None = None, details: str | None = None) -> None:
    """Expose safe, concise resource state in config-entry diagnostics."""
    data = {"result": result}
    if url is not None:
        data["url"] = url
    if details is not None:
        data["details"] = details
    hass.data[_STATUS_KEY] = data


def _is_our_resource(url: object) -> bool:
    """Match exactly our local static path, not remote URLs or other cards."""
    if not isinstance(url, str):
        return False
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    return not parsed.scheme and not parsed.netloc and parsed.path == CARD_RESOURCE_PATH


async def _integration_version(hass) -> str:
    """Use HA's manifest cache; no Path.read_text/open on the event loop.

    Home Assistant's loader caches Integration objects, and transparently
    offloads manifest loading if the cache ever needs to be populated.
    """
    integration = await async_get_integration(hass, DOMAIN)
    version = integration.version
    if not version:
        raise ValueError(f"Missing manifest version for {DOMAIN}")
    return str(version)


async def async_register_card_resource(hass) -> None:
    """Safely enroll the card once; concurrent setup calls are serialized."""
    lock = hass.data.setdefault(_LOCK_KEY, asyncio.Lock())
    async with lock:
        await _async_register_card_resource_unlocked(hass)


async def _async_register_card_resource_unlocked(hass) -> None:
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        _status(hass, "unavailable", details="Lovelace component is not loaded")
        _LOGGER.warning("P2Talk Lovelace resource not registered: Lovelace is unavailable")
        return

    resource_mode = getattr(lovelace, "resource_mode", getattr(lovelace, "mode", "storage"))
    if resource_mode != "storage":
        _status(hass, "yaml_mode", details="Resources are managed by configuration.yaml")
        _LOGGER.info("P2Talk automatic Lovelace resource enrollment skipped: resource_mode=%s; "
                     "add %s as a module in YAML", resource_mode, CARD_RESOURCE_PATH)
        return

    resources = lovelace.resources
    try:
        # Never use the collection before its existing contents are loaded.
        if not getattr(resources, "loaded", False):
            await resources.async_get_info()
        if not getattr(resources, "loaded", False):
            _status(hass, "failed", details="Lovelace resource storage did not load")
            _LOGGER.error("P2Talk Resource enrollment aborted: storage did not load, "
                          "no resources were changed")
            return

        current_url = f"{CARD_RESOURCE_PATH}?v={await _integration_version(hass)}"
        existing = [item for item in resources.async_items() if _is_our_resource(item.get("url"))]
        if existing:
            # Preserve the original ID when migrating an old manual resource.
            item = next((entry for entry in existing if entry.get("type") == "module"), existing[0])
            if item.get("url") != current_url or item.get("type") != "module":
                await resources.async_update_item(
                    item["id"], {"url": current_url, "res_type": "module"}
                )
                _LOGGER.info("P2Talk Lovelace resource updated: %s", current_url)
                result = "updated"
            else:
                _LOGGER.debug("P2Talk Lovelace resource already up-to-date: %s", current_url)
                result = "already_registered"
            if len(existing) > 1:
                _LOGGER.warning(
                    "P2Talk found %d matching Resources; retained duplicate entries "
                    "to avoid changing dashboards. Remove duplicates via Settings > Dashboards > Resources",
                    len(existing),
                )
            _status(hass, result, url=current_url,
                    details=f"{len(existing)} matching resource(s)")
            return

        await resources.async_create_item({"url": current_url, "res_type": "module"})
        _status(hass, "registered", url=current_url)
        _LOGGER.info("P2Talk Lovelace module registered automatically: %s", current_url)
    except Exception as err:  # noqa: BLE001 - card failure must not stop Core setup
        _status(hass, "failed", details=f"{type(err).__name__}: {str(err)[:180]}")
        _LOGGER.exception("P2Talk Lovelace Resource registration failed; "
                          "audio backend is still available and other Resources were not modified")
