"""UI configuration for P2Talk Google Cast."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant import config_entries

from .const import (
    CONF_AUDIO_BITRATE,
    CONF_DEFAULT_VOLUME,
    CONF_FFMPEG_PATH,
    CONF_MAX_RECORD_SECONDS,
    CONF_RETENTION_HOURS,
    DEFAULTS,
    DOMAIN,
    NAME,
)


def options_schema(options: Mapping[str, Any]) -> vol.Schema:
    """Build UI schema using stored values as defaults."""
    def value(key: str) -> Any:
        return options.get(key, DEFAULTS[key])

    return vol.Schema(
        {
            vol.Required(CONF_AUDIO_BITRATE, default=value(CONF_AUDIO_BITRATE)): vol.In(
                ["64k", "96k", "128k", "192k"]
            ),
            vol.Required(
                CONF_MAX_RECORD_SECONDS, default=value(CONF_MAX_RECORD_SECONDS)
            ): vol.All(vol.Coerce(int), vol.Range(min=10, max=300)),
            vol.Required(
                CONF_RETENTION_HOURS, default=value(CONF_RETENTION_HOURS)
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=48)),
            vol.Required(
                CONF_DEFAULT_VOLUME, default=value(CONF_DEFAULT_VOLUME)
            ): vol.All(vol.Coerce(float), vol.Range(min=0.05, max=1.0)),
            vol.Required(CONF_FFMPEG_PATH, default=value(CONF_FFMPEG_PATH)): vol.All(
                str, vol.Length(min=1, max=256)
            ),
        }
    )


class P2TalkGoogleCastConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Set up one P2Talk Google Cast instance with no tokens or external URL."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Create the integration after confirmation."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        """Return the integration's Options Flow."""
        return P2TalkGoogleCastOptionsFlow()


class P2TalkGoogleCastOptionsFlow(config_entries.OptionsFlow):
    """Manage runtime settings from Devices & services."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        """Show and save the options form."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)
        return self.async_show_form(
            step_id="init", data_schema=options_schema(self.config_entry.options)
        )
