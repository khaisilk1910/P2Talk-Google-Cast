"""Home Assistant config and native Options Flow speaker management."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers import selector

from .const import (
    CONF_AUDIO_BITRATE,
    CONF_DEFAULT_VOLUME,
    CONF_FFMPEG_PATH,
    CONF_MAX_RECORD_SECONDS,
    CONF_RETENTION_HOURS,
    CONF_SPEAKERS,
    DEFAULTS,
    DOMAIN,
    NAME,
)
from .speakers import configured_speakers, remove_speaker, speaker_by_id, upsert_speaker


def _speaker_selector(multiple: bool = False) -> selector.EntitySelector:
    return selector.EntitySelector(
        selector.EntitySelectorConfig(domain="media_player", multiple=multiple)
    )


def options_schema(options: Mapping[str, Any]) -> vol.Schema:
    """Settings apply without reloading the panel or integration."""
    def value(key: str) -> Any:
        return options.get(key, DEFAULTS[key])

    return vol.Schema({
        vol.Required(CONF_AUDIO_BITRATE, default=value(CONF_AUDIO_BITRATE)): vol.In(["48k", "64k", "96k", "128k"]),
        vol.Required(CONF_MAX_RECORD_SECONDS, default=value(CONF_MAX_RECORD_SECONDS)): vol.All(vol.Coerce(int), vol.Range(min=10, max=300)),
        vol.Required(CONF_RETENTION_HOURS, default=value(CONF_RETENTION_HOURS)): vol.All(vol.Coerce(int), vol.Range(min=1, max=48)),
        vol.Required(CONF_DEFAULT_VOLUME, default=value(CONF_DEFAULT_VOLUME)): vol.All(vol.Coerce(float), vol.Range(min=0.05, max=1.0)),
        vol.Required(CONF_FFMPEG_PATH, default=value(CONF_FFMPEG_PATH)): vol.All(str, vol.Length(min=1, max=256)),
    })


def _speaker_schema(speaker: Mapping[str, Any] | None = None) -> vol.Schema:
    speaker = speaker or {}
    return vol.Schema({
        vol.Required("entity_id", default=speaker.get("entity_id", vol.UNDEFINED)): _speaker_selector(),
        vol.Optional("name", default=speaker.get("name", "")): vol.All(str, vol.Length(max=64)),
        vol.Required("volume", default=speaker.get("volume") or 0.65): vol.All(vol.Coerce(float), vol.Range(min=0.05, max=1.0)),
    })


class P2TalkGoogleCastConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create exactly one local P2Talk instance."""

    VERSION = 1  # Additive options schema; existing v1 config entries remain valid
    MINOR_VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            speakers = [{"entity_id": s, "name": "", "volume": DEFAULTS[CONF_DEFAULT_VOLUME]}
                        for s in user_input.get(CONF_SPEAKERS, [])]
            return self.async_create_entry(title=NAME, data={}, options={CONF_SPEAKERS: speakers})
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Optional(CONF_SPEAKERS): _speaker_selector(multiple=True)}),
        )

    @staticmethod
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        return P2TalkGoogleCastOptionsFlow()


class P2TalkGoogleCastOptionsFlow(config_entries.OptionsFlow):
    """Add / rename / update / remove individual speakers, plus audio settings."""

    _selected: str | None = None

    def _choices(self) -> dict[str, str]:
        return {s["entity_id"]: (s["name"] or s["entity_id"]) for s in configured_speakers(self.config_entry.options)}

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        choices = ["add", "settings"]
        if configured_speakers(self.config_entry.options):
            choices.extend(["edit_select", "remove_select"])
        return self.async_show_menu(step_id="init", menu_options=choices)

    async def async_step_add(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}
        if user_input is not None:
            if speaker_by_id(self.config_entry.options, user_input["entity_id"]):
                errors["entity_id"] = "already_added"
            else:
                opts = upsert_speaker(self.config_entry.options, {
                    "entity_id": user_input["entity_id"],
                    "name": user_input.get("name", "").strip(),
                    "volume": user_input["volume"],
                })
                return self.async_create_entry(title="", data=opts)
        return self.async_show_form(step_id="add", data_schema=_speaker_schema(), errors=errors)

    async def async_step_edit_select(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            self._selected = user_input["speaker"]
            return await self.async_step_edit()
        return self.async_show_form(step_id="edit_select", data_schema=vol.Schema({
            vol.Required("speaker"): vol.In(self._choices()),
        }))

    async def async_step_edit(self, user_input: dict[str, Any] | None = None):
        existing = speaker_by_id(self.config_entry.options, self._selected or "")
        if existing is None:
            return self.async_abort(reason="speaker_missing")
        errors: dict[str, str] = {}
        if user_input is not None:
            other = speaker_by_id(self.config_entry.options, user_input["entity_id"])
            if other and other["entity_id"] != self._selected:
                errors["entity_id"] = "already_added"
            else:
                opts = upsert_speaker(self.config_entry.options, {
                    "entity_id": user_input["entity_id"],
                    "name": user_input.get("name", "").strip(),
                    "volume": user_input["volume"],
                }, original=self._selected)
                return self.async_create_entry(title="", data=opts)
        return self.async_show_form(step_id="edit", data_schema=_speaker_schema(existing), errors=errors)

    async def async_step_remove_select(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            self._selected = user_input["speaker"]
            return await self.async_step_remove()
        return self.async_show_form(step_id="remove_select", data_schema=vol.Schema({
            vol.Required("speaker"): vol.In(self._choices()),
        }))

    async def async_step_remove(self, user_input: dict[str, Any] | None = None):
        if speaker_by_id(self.config_entry.options, self._selected or "") is None:
            return self.async_abort(reason="speaker_missing")
        if user_input is not None and user_input.get("confirm") is True:
            return self.async_create_entry(title="", data=remove_speaker(self.config_entry.options, self._selected))
        return self.async_show_form(step_id="remove", data_schema=vol.Schema({
            vol.Required("confirm", default=False): bool,
        }), errors={"base": "not_confirmed"} if user_input is not None else {})

    async def async_step_settings(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data={
                **{key: val for key, val in self.config_entry.options.items() if key != "mic_https_url"},
                **user_input,
            })
        return self.async_show_form(step_id="settings", data_schema=options_schema(self.config_entry.options))
