"""Lightweight Home Assistant diagnostics, without raw recordings or credentials."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from .const import CONF_FFMPEG_PATH, CONF_SPEAKERS, DOMAIN
from .speakers import configured_speakers


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry) -> dict:
    """Export configuration and availability, not microphone/audio content."""
    speakers = []
    for speaker in configured_speakers(entry.options):
        state = hass.states.get(speaker["entity_id"])
        speakers.append({
            "entity_id": speaker["entity_id"],
            "configured_alias": speaker["name"],
            "state": state.state if state else "not_found",
            "supported_features": state.attributes.get("supported_features") if state else None,
        })
    runtime = hass.data.get(DOMAIN)
    return {
        "configured_speaker_count": len(speakers),
        "speakers": speakers,
        "options": {k: ("[redacted]" if k in (CONF_FFMPEG_PATH, "mic_https_url") else v)
                    for k, v in entry.options.items() if k != CONF_SPEAKERS},
        "active_uploads": len(runtime.uploads) if runtime else 0,
        "active_conversions": len(runtime.processing_users) if runtime else 0,
        "note": "No audio samples or authorization tokens are included.",
    }
