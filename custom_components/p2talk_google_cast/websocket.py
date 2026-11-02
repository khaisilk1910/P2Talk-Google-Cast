"""Authenticated Home Assistant WebSocket API for P2Talk Google Cast."""

from __future__ import annotations

import asyncio
import base64
import binascii
from dataclasses import dataclass
from collections.abc import Callable
import logging
import uuid

import voluptuous as vol

from homeassistant.auth.permissions.const import POLICY_CONTROL, POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.components.media_player import MediaPlayerEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from .audio import AudioError, async_cleanup, async_convert
from .const import (
    AUDIO_FORMATS,
    CONF_DEFAULT_VOLUME,
    DEFAULTS,
    DOMAIN,
    MAX_ACTIVE_UPLOADS,
    MAX_AUDIO_BYTES,
    MAX_CHUNK_BYTES,
    UPLOAD_TTL_SECONDS,
)

_LOGGER = logging.getLogger(__name__)


@dataclass
class Upload:
    """One short-lived upload, tied to a logged-in HA user."""

    user_id: str
    content: bytearray
    mime_type: str
    cancel_expiry: Callable[[], None]


class Runtime:
    """All non-persistent runtime state for the single config entry."""

    def __init__(self, entry) -> None:
        self.entry = entry
        self.active = True
        self.uploads: dict[str, Upload] = {}
        self.processing_users: set[str] = set()
        self.convert_semaphore = asyncio.Semaphore(2)

    def clear_uploads(self) -> None:
        """Revoke in-flight uploads when integration is removed/reloaded."""
        self.active = False
        for upload in self.uploads.values():
            upload.cancel_expiry()
        self.uploads.clear()


def _runtime(hass: HomeAssistant, connection, msg) -> Runtime | None:
    runtime = hass.data.get(DOMAIN)
    if runtime is None or not runtime.active:
        connection.send_error(msg["id"], "not_loaded", "P2Talk Google Cast is not configured")
        return None
    return runtime


def _owned_upload(runtime: Runtime, connection, msg) -> Upload | None:
    upload = runtime.uploads.get(msg["upload_id"])
    if upload is None or upload.user_id != connection.user.id:
        connection.send_error(msg["id"], "not_found", "Upload not found")
        return None
    return upload


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/speakers"})
@callback
def ws_speakers(hass: HomeAssistant, connection, msg) -> None:
    """List playable media players visible to the logged-in HA user."""
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    speakers = []
    for state in hass.states.async_all("media_player"):
        entity_id = state.entity_id
        if not connection.user.is_admin and not connection.user.permissions.check_entity(
            entity_id, POLICY_READ
        ):
            continue
        features = int(state.attributes.get("supported_features") or 0)
        if not features & MediaPlayerEntityFeature.PLAY_MEDIA:
            continue
        speakers.append(
            {
                "entity_id": entity_id,
                "friendly_name": state.name,
                "state": state.state,
                "is_available": state.state not in ("unavailable", "unknown"),
                "is_cast": "cast" in entity_id.lower()
                or "google" in entity_id.lower()
                or "google" in state.name.lower(),
                "volume_level": state.attributes.get("volume_level"),
            }
        )
    speakers.sort(
        key=lambda s: (not s["is_available"], not s["is_cast"], s["friendly_name"].casefold())
    )
    connection.send_result(
        msg["id"],
        {
            "speakers": speakers,
            "max_seconds": runtime.entry.options.get("max_record_seconds", 120),
            "default_volume": runtime.entry.options.get(
                CONF_DEFAULT_VOLUME, DEFAULTS[CONF_DEFAULT_VOLUME]
            ),
            "max_bytes": MAX_AUDIO_BYTES,
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/upload_start", vol.Required("mime_type"): str})
@callback
def ws_upload_start(hass: HomeAssistant, connection, msg) -> None:
    """Allocate a bounded, expiring recording buffer only after user action."""
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    if msg["mime_type"] not in AUDIO_FORMATS:
        connection.send_error(msg["id"], "unsupported", "Unsupported audio container")
        return
    if connection.user.id in runtime.processing_users:
        connection.send_error(msg["id"], "busy", "Previous recording is still being processed")
        return
    if len(runtime.uploads) >= MAX_ACTIVE_UPLOADS or any(
        session.user_id == connection.user.id for session in runtime.uploads.values()
    ):
        connection.send_error(msg["id"], "busy", "Another recording is already uploading")
        return
    upload_id = uuid.uuid4().hex

    @callback
    def expire(_now) -> None:
        runtime.uploads.pop(upload_id, None)

    cancel = async_call_later(hass, UPLOAD_TTL_SECONDS, expire)
    runtime.uploads[upload_id] = Upload(connection.user.id, bytearray(), msg["mime_type"], cancel)
    connection.send_result(msg["id"], {"upload_id": upload_id})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/upload_chunk",
        vol.Required("upload_id"): str,
        vol.Required("data"): str,
    }
)
@callback
def ws_upload_chunk(hass: HomeAssistant, connection, msg) -> None:
    """Accept one base64 chunk with independent limits on its decoded size."""
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    upload = _owned_upload(runtime, connection, msg)
    if upload is None:
        return
    data = msg["data"]
    if len(data) > ((MAX_CHUNK_BYTES + 2) // 3) * 4:
        connection.send_error(msg["id"], "too_large", "Audio chunk too large")
        return
    try:
        chunk = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        connection.send_error(msg["id"], "invalid_chunk", "Invalid audio chunk")
        return
    if not chunk or len(chunk) > MAX_CHUNK_BYTES or len(upload.content) + len(chunk) > MAX_AUDIO_BYTES:
        connection.send_error(msg["id"], "too_large", "Audio upload exceeds limit")
        return
    upload.content.extend(chunk)
    connection.send_result(msg["id"], {"received": len(upload.content)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/upload_cancel",
        vol.Required("upload_id"): str,
    }
)
@callback
def ws_upload_cancel(hass: HomeAssistant, connection, msg) -> None:
    """Release a recording buffer without writing it to disk."""
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    upload = _owned_upload(runtime, connection, msg)
    if upload is None:
        return
    runtime.uploads.pop(msg["upload_id"])
    upload.cancel_expiry()
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/upload_finish",
        vol.Required("upload_id"): str,
        vol.Required("speaker"): str,
        vol.Required("volume"): vol.All(vol.Coerce(float), vol.Range(min=0.05, max=1.0)),
    }
)
@websocket_api.async_response
async def ws_upload_finish(hass: HomeAssistant, connection, msg) -> None:
    """Transcode off the event loop and play via HA's local media source."""
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    upload = _owned_upload(runtime, connection, msg)
    if upload is None:
        return
    upload.cancel_expiry()
    runtime.uploads.pop(msg["upload_id"], None)
    entity_id = msg["speaker"]
    state = hass.states.get(entity_id)
    if (
        not entity_id.startswith("media_player.")
        or state is None
        or state.state in ("unavailable", "unknown")
        or not (int(state.attributes.get("supported_features") or 0) & MediaPlayerEntityFeature.PLAY_MEDIA)
        or not connection.user.is_admin and not connection.user.permissions.check_entity(entity_id, POLICY_CONTROL)
    ):
        connection.send_error(msg["id"], "unauthorized", "Cannot control this media player")
        return
    if connection.user.id in runtime.processing_users or len(runtime.processing_users) >= 2:
        connection.send_error(msg["id"], "busy", "Audio converter is busy")
        return
    if not upload.content:
        connection.send_error(msg["id"], "empty", "No audio received")
        return
    runtime.processing_users.add(connection.user.id)
    try:
        async with runtime.convert_semaphore:
            media_id = await async_convert(hass, bytes(upload.content), runtime.entry.options, upload.mime_type)
        # Do not retain microphone input after conversion.
        upload.content.clear()
        if not runtime.active:
            connection.send_error(msg["id"], "not_loaded", "Integration was unloaded")
            return
        context = connection.context(msg)
        features = int(state.attributes.get("supported_features") or 0)
        if features & MediaPlayerEntityFeature.VOLUME_SET:
            await hass.services.async_call(
                "media_player",
                "volume_set",
                {"entity_id": entity_id, "volume_level": msg["volume"]},
                blocking=True,
                context=context,
            )
        await hass.services.async_call(
            "media_player",
            "play_media",
            {
                "entity_id": entity_id,
                "media_content_id": media_id,
                "media_content_type": "music",
            },
            blocking=True,
            context=context,
        )
        connection.send_result(msg["id"], {"speaker": entity_id, "media_id": media_id})
        # Cleanup is also scheduled hourly to catch old recordings when idle.
        hass.async_create_task(async_cleanup(hass, runtime.entry.options), f"{DOMAIN} cleanup")
    except AudioError as err:
        connection.send_error(msg["id"], "audio_error", str(err))
    except Exception:
        _LOGGER.exception("Unable to play P2Talk Google Cast recording")
        connection.send_error(msg["id"], "playback_failed", "Cannot play audio on this speaker")
    finally:
        runtime.processing_users.discard(connection.user.id)
        upload.content.clear()


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/stop",
        vol.Required("speaker"): str,
    }
)
@websocket_api.async_response
async def ws_stop(hass: HomeAssistant, connection, msg) -> None:
    """Stop playback using Home Assistant service permissions."""
    if _runtime(hass, connection, msg) is None:
        return
    entity_id = msg["speaker"]
    if (
        not entity_id.startswith("media_player.")
        or hass.states.get(entity_id) is None
        or not connection.user.is_admin and not connection.user.permissions.check_entity(entity_id, POLICY_CONTROL)
    ):
        connection.send_error(msg["id"], "unauthorized", "Cannot control this media player")
        return
    try:
        await hass.services.async_call(
            "media_player", "media_stop", {"entity_id": entity_id},
            blocking=True, context=connection.context(msg)
        )
        connection.send_result(msg["id"])
    except Exception:
        _LOGGER.exception("Unable to stop P2Talk Google Cast speaker")
        connection.send_error(msg["id"], "stop_failed", "Cannot stop this speaker")


def register_commands(hass: HomeAssistant) -> None:
    """Register commands once, including after a config-entry reload."""
    for command in (
        ws_speakers,
        ws_upload_start,
        ws_upload_chunk,
        ws_upload_finish,
        ws_upload_cancel,
        ws_stop,
    ):
        websocket_api.async_register_command(hass, command)
