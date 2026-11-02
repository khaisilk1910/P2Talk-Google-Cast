"""Home Assistant-native P2Talk Google Cast integration.

No network requests, polling, FFmpeg subprocesses, or media-folder scans on HA startup.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval

from .audio import async_cleanup
from .const import DOMAIN, NAME, PANEL_PATH
from .websocket import Runtime, register_commands

_ASSETS_REGISTERED = f"{DOMAIN}_static_assets_registered"


async def async_setup_entry(hass: HomeAssistant, entry) -> bool:
    """Register a lightweight sidebar panel and on-demand WebSocket handlers."""
    runtime = Runtime(entry)
    hass.data[DOMAIN] = runtime

    # Static paths are process-wide; never re-register on Options Flow reload.
    if not hass.data.get(_ASSETS_REGISTERED):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    f"/{DOMAIN}_assets",
                    str(Path(__file__).parent / "frontend"),
                    cache_headers=False,
                )
            ]
        )
        hass.data[_ASSETS_REGISTERED] = True

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_PATH,
        webcomponent_name="p2talk-google-cast-panel",
        module_url=f"/{DOMAIN}_assets/panel.js?v=1.0.0",
        sidebar_title=NAME,
        sidebar_icon="mdi:microphone-message",
        require_admin=False,
        embed_iframe=False,
    )
    register_commands(hass)

    async def _periodic_cleanup(_now) -> None:
        await async_cleanup(hass, entry.options)

    entry.async_on_unload(async_track_time_interval(hass, _periodic_cleanup, timedelta(hours=1)))
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def _async_options_updated(hass: HomeAssistant, entry) -> None:
    """Apply changed options without restarting Home Assistant."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry) -> bool:
    """Remove the panel and cancel timers when the integration is unloaded."""
    runtime: Runtime | None = hass.data.pop(DOMAIN, None)
    if runtime is not None:
        runtime.clear_uploads()
    frontend.async_remove_panel(hass, PANEL_PATH, warn_if_unknown=False)
    entry.async_unload()
    return True
