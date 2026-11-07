"""P2Talk Google Cast backend with automatically enrolled Lovelace cards."""

from __future__ import annotations

from datetime import timedelta
import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import CoreState, EVENT_HOMEASSISTANT_STARTED, HomeAssistant
from homeassistant.helpers.event import async_track_time_interval

from .audio import async_cleanup
from .const import DOMAIN
from .lovelace_resources import async_register_card_resource
from .speakers import configured_speakers
from .websocket import Runtime, register_commands

_LOGGER = logging.getLogger(__name__)
_ASSETS_REGISTERED = f"{DOMAIN}_static_assets_registered"


async def async_setup_entry(hass: HomeAssistant, entry) -> bool:
    """Set up the backend and serve cards without delaying HA startup.

    Only the P2Talk resource is enrolled, asynchronously after startup.
    Dashboards, other Lovelace resources and YAML remain untouched.
    """
    if "mic_https_url" in entry.options:
        hass.config_entries.async_update_entry(
            entry, options={key: val for key, val in entry.options.items() if key != "mic_https_url"}
        )
    runtime = Runtime(entry)
    hass.data[f"{DOMAIN}_lovelace_resource_status"] = {"result": "pending"}
    hass.data[DOMAIN] = runtime
    if not hass.data.get(_ASSETS_REGISTERED):
        await hass.http.async_register_static_paths([
            StaticPathConfig(
                f"/{DOMAIN}_assets",
                str(Path(__file__).parent / "frontend"),
                cache_headers=True,  # Versioned Resource URL invalidates long-lived browser cache.
            )
        ])
        hass.data[_ASSETS_REGISTERED] = True
    register_commands(hass)

    if hass.state == CoreState.running:
        # Schedule enrollment outside setup; manifest metadata is loader-cached.
        entry.async_create_background_task(
            hass, async_register_card_resource(hass),
            f"{DOMAIN} register Lovelace resource",
        )
    else:
        async def _register_after_started(_event) -> None:
            # Do not register if this entry was unloaded before HA started.
            if hass.data.get(DOMAIN) is runtime:
                await async_register_card_resource(hass)

        entry.async_on_unload(
            hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _register_after_started)
        )

    async def periodic_cleanup(_now) -> None:
        await async_cleanup(hass, entry.options)

    entry.async_on_unload(async_track_time_interval(hass, periodic_cleanup, timedelta(hours=1)))
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    _LOGGER.info(
        "P2Talk Google Cast cards ready: %d configured speakers; no panel or background audio worker",
        len(configured_speakers(entry.options)),
    )
    return True


async def _async_options_updated(hass: HomeAssistant, entry) -> None:
    """Speaker options are always read live, without integration reloading."""
    _LOGGER.info("P2Talk options updated: %d allowed speakers", len(configured_speakers(entry.options)))


async def async_unload_entry(hass: HomeAssistant, entry) -> bool:
    runtime: Runtime | None = hass.data.pop(DOMAIN, None)
    if runtime:
        runtime.clear_uploads()
    entry.async_unload()
    _LOGGER.info("P2Talk unloaded")
    return True
