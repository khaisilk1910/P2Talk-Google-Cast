"""Lightweight, local-only P2Talk Google Cast custom integration."""

from __future__ import annotations

from datetime import timedelta
import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval

from .audio import async_cleanup
from .const import DOMAIN, NAME, PANEL_PATH
from .speakers import configured_speakers
from .websocket import Runtime, register_commands

_LOGGER = logging.getLogger(__name__)
_ASSETS_REGISTERED = f"{DOMAIN}_static_assets_registered"


async def async_setup_entry(hass: HomeAssistant, entry) -> bool:
    """No discovery, file scans, subprocesses, or network requests at boot."""
    # Old releases allowed a per-integration HTTPS URL. Always use HA-managed
    # Network URLs now, and remove any stale option without restarting HA.
    if "mic_https_url" in entry.options:
        hass.config_entries.async_update_entry(
            entry, options={key: val for key, val in entry.options.items() if key != "mic_https_url"}
        )
    runtime = Runtime(entry)
    hass.data[DOMAIN] = runtime
    if not hass.data.get(_ASSETS_REGISTERED):
        await hass.http.async_register_static_paths([
            StaticPathConfig(f"/{DOMAIN}_assets", str(Path(__file__).parent / "frontend"), cache_headers=True)
        ])
        hass.data[_ASSETS_REGISTERED] = True
    # Cache-bust the browser JS after every installation/update without hardcoding
    # a release version or hashing the asset during Home Assistant startup.
    panel_asset_version = (Path(__file__).parent / "frontend" / "panel.js").stat().st_mtime_ns
    await panel_custom.async_register_panel(
        hass, frontend_url_path=PANEL_PATH,
        webcomponent_name="p2talk-google-cast-panel",
        module_url=f"/{DOMAIN}_assets/panel.js?v={panel_asset_version}",
        sidebar_title=NAME,
        sidebar_icon="mdi:cast-audio",
        require_admin=False, embed_iframe=False,
    )
    register_commands(hass)

    async def periodic_cleanup(_now) -> None:
        await async_cleanup(hass, entry.options)

    entry.async_on_unload(async_track_time_interval(hass, periodic_cleanup, timedelta(hours=1)))
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    _LOGGER.info("P2Talk Google Cast ready: %d configured speakers; no background audio worker",
                 len(configured_speakers(entry.options)))
    return True


async def _async_options_updated(hass: HomeAssistant, entry) -> None:
    """Runtime reads entry.options live; do not reload or impact HA startup."""
    _LOGGER.info("P2Talk options updated: %d allowed speakers", len(configured_speakers(entry.options)))


async def async_unload_entry(hass: HomeAssistant, entry) -> bool:
    runtime: Runtime | None = hass.data.pop(DOMAIN, None)
    if runtime:
        runtime.clear_uploads()
    frontend.async_remove_panel(hass, PANEL_PATH, warn_if_unknown=False)
    entry.async_unload()
    _LOGGER.info("P2Talk unloaded")
    return True
