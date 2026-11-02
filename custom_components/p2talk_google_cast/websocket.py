"""Authenticated, bounded, speaker-allowlisted Home Assistant WebSocket API."""

from __future__ import annotations

import asyncio
import base64
import binascii
from dataclasses import dataclass
from collections.abc import Callable
import logging
from time import monotonic
import uuid

import voluptuous as vol

from homeassistant.auth.permissions.const import POLICY_CONTROL, POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.components.media_player import MediaPlayerEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from .audio import AudioError, async_convert
from .const import (
    AUDIO_FORMATS,
    CONF_DEFAULT_VOLUME,
    CONF_MAX_RECORD_SECONDS,
    DEFAULTS,
    DOMAIN,
    MAX_ACTIVE_UPLOADS,
    MAX_AUDIO_BYTES,
    MAX_CHUNK_BYTES,
    UPLOAD_TTL_SECONDS,
)
from .speakers import configured_speakers, speaker_by_id

_LOGGER = logging.getLogger(__name__)
_REGISTERED_KEY = f"{DOMAIN}_ws_registered"


@dataclass
class Upload:
    user_id: str
    content: bytearray
    mime_type: str
    cancel_expiry: Callable[[], None]
    started: float
    next_chunk: int = 0


class Runtime:
    """No resident workers or network clients; only active uploads in RAM."""

    def __init__(self, entry) -> None:
        self.entry = entry
        self.active = True
        self.uploads: dict[str, Upload] = {}
        self.processing_users: set[str] = set()
        self.convert_semaphore = asyncio.Semaphore(2)

    def clear_uploads(self) -> None:
        self.active = False
        for upload in self.uploads.values():
            upload.cancel_expiry()
            upload.content.clear()
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
        connection.send_error(msg["id"], "not_found", "Recording session expired or not owned by this user")
        return None
    return upload


def _can_control(connection, entity_id: str) -> bool:
    return connection.user.is_admin or connection.user.permissions.check_entity(entity_id, POLICY_CONTROL)


def _selected_speaker(hass, runtime, connection, msg):
    """Enforce allowlist on BOTH stop and finish, never trust the dropdown."""
    entity = msg["speaker"]
    item = speaker_by_id(runtime.entry.options, entity)
    if item is None:
        connection.send_error(msg["id"], "not_configured", "Loa chưa được thêm vào cấu hình P2Talk.")
        return None
    state = hass.states.get(entity)
    if not _can_control(connection, entity):
        connection.send_error(msg["id"], "unauthorized", "Bạn không có quyền điều khiển loa này.")
        return None
    if state is None or state.state in ("unknown", "unavailable"):
        connection.send_error(msg["id"], "speaker_offline", "Loa offline hoặc chưa được Google Cast phát hiện.")
        return None
    return state


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/speakers"})
@callback
def ws_speakers(hass: HomeAssistant, connection, msg) -> None:
    """Expose ONLY configured speakers; do not scan the network or create entities."""
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    speakers = []
    for item in configured_speakers(runtime.entry.options):
        entity_id = item["entity_id"]
        if not connection.user.is_admin and not connection.user.permissions.check_entity(entity_id, POLICY_READ):
            continue
        state = hass.states.get(entity_id)
        features = int(state.attributes.get("supported_features") or 0) if state else 0
        available = bool(state and state.state not in ("unknown", "unavailable"))
        speakers.append({
            "entity_id": entity_id,
            "friendly_name": item["name"] or (state.name if state else entity_id),
            "state": state.state if state else "not_found",
            "is_available": available and bool(features & MediaPlayerEntityFeature.PLAY_MEDIA),
            "volume_level": state.attributes.get("volume_level") if state else None,
            "configured_volume": item["volume"] if item["volume"] is not None else runtime.entry.options.get(CONF_DEFAULT_VOLUME, DEFAULTS[CONF_DEFAULT_VOLUME]),
        })
    connection.send_result(msg["id"], {
        "speakers": speakers,
        "max_seconds": runtime.entry.options.get(CONF_MAX_RECORD_SECONDS, DEFAULTS[CONF_MAX_RECORD_SECONDS]),
        "default_volume": runtime.entry.options.get(CONF_DEFAULT_VOLUME, DEFAULTS[CONF_DEFAULT_VOLUME]),
        "max_bytes": MAX_AUDIO_BYTES,
    })


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/upload_start",
    vol.Required("mime_type"): str,
})
@callback
def ws_upload_start(hass: HomeAssistant, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    if msg["mime_type"] not in AUDIO_FORMATS:
        connection.send_error(msg["id"], "unsupported", "Unsupported audio container")
        return
    if connection.user.id in runtime.processing_users:
        connection.send_error(msg["id"], "busy", "Previous recording is still processing")
        return
    if len(runtime.uploads) >= MAX_ACTIVE_UPLOADS or any(s.user_id == connection.user.id for s in runtime.uploads.values()):
        connection.send_error(msg["id"], "busy", "Too many recordings uploading")
        return
    upload_id = uuid.uuid4().hex

    @callback
    def expire(_now) -> None:
        upload = runtime.uploads.pop(upload_id, None)
        if upload:
            upload.content.clear()
            _LOGGER.debug("P2Talk [%s] upload expired", upload_id[:8])

    cancel = async_call_later(hass, UPLOAD_TTL_SECONDS, expire)
    runtime.uploads[upload_id] = Upload(connection.user.id, bytearray(), msg["mime_type"], cancel, monotonic())
    _LOGGER.debug("P2Talk [%s] recording transfer started, type=%s", upload_id[:8], msg["mime_type"])
    connection.send_result(msg["id"], {"upload_id": upload_id})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/upload_chunk",
    vol.Required("upload_id"): str,
    vol.Required("index"): vol.All(vol.Coerce(int), vol.Range(min=0, max=10000)),
    vol.Required("data"): str,
})
@callback
def ws_upload_chunk(hass: HomeAssistant, connection, msg) -> None:
    """Ordered chunks can be sent with several in-flight WS acknowledgements."""
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    upload = _owned_upload(runtime, connection, msg)
    if upload is None:
        return
    if msg["index"] != upload.next_chunk:
        connection.send_error(msg["id"], "out_of_order", "Unexpected audio chunk order")
        return
    encoded = msg["data"]
    if len(encoded) > ((MAX_CHUNK_BYTES + 2) // 3) * 4:
        connection.send_error(msg["id"], "too_large", "Audio chunk too large")
        return
    try:
        chunk = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        connection.send_error(msg["id"], "invalid_chunk", "Invalid audio chunk")
        return
    if not chunk or len(chunk) > MAX_CHUNK_BYTES or len(upload.content) + len(chunk) > MAX_AUDIO_BYTES:
        connection.send_error(msg["id"], "too_large", "Audio upload exceeds limit")
        return
    upload.content.extend(chunk)
    upload.next_chunk += 1
    connection.send_result(msg["id"], {"received": len(upload.content)})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/upload_cancel",
    vol.Required("upload_id"): str,
})
@callback
def ws_upload_cancel(hass: HomeAssistant, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    upload = _owned_upload(runtime, connection, msg)
    if upload is None:
        return
    runtime.uploads.pop(msg["upload_id"], None)
    upload.cancel_expiry()
    upload.content.clear()
    connection.send_result(msg["id"])


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/upload_finish",
    vol.Required("upload_id"): str,
    vol.Required("speaker"): str,
    vol.Required("volume"): vol.All(vol.Coerce(float), vol.Range(min=0.05, max=1.0)),
})
@websocket_api.async_response
async def ws_upload_finish(hass: HomeAssistant, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    upload = _owned_upload(runtime, connection, msg)
    if upload is None:
        return
    upload.cancel_expiry()
    runtime.uploads.pop(msg["upload_id"], None)
    tag = msg["upload_id"][:8]
    entity_id = msg["speaker"]
    state = _selected_speaker(hass, runtime, connection, msg)
    if state is None:
        upload.content.clear()
        return
    features = int(state.attributes.get("supported_features") or 0)
    if not features & MediaPlayerEntityFeature.PLAY_MEDIA:
        upload.content.clear()
        connection.send_error(msg["id"], "unsupported", "Loa không hỗ trợ play_media.")
        return
    if connection.user.id in runtime.processing_users or len(runtime.processing_users) >= 2:
        upload.content.clear()
        connection.send_error(msg["id"], "busy", "Audio converter is busy")
        return
    if not upload.content:
        connection.send_error(msg["id"], "empty", "No audio received")
        return
    runtime.processing_users.add(connection.user.id)
    started = monotonic()
    transfer_ms = round((started - upload.started) * 1000)
    size = len(upload.content)
    try:
        async with runtime.convert_semaphore:
            media_id = await async_convert(hass, bytes(upload.content), runtime.entry.options, upload.mime_type)
        convert_ms = round((monotonic() - started) * 1000)
        upload.content.clear()
        if not runtime.active or speaker_by_id(runtime.entry.options, entity_id) is None:
            connection.send_error(msg["id"], "not_loaded", "Integration unloaded or speaker removed")
            return
        context = connection.context(msg)
        current_volume = state.attributes.get("volume_level")
        if (features & MediaPlayerEntityFeature.VOLUME_SET and (
            not isinstance(current_volume, (int, float)) or abs(current_volume - msg["volume"]) > 0.02
        )):
            await hass.services.async_call("media_player", "volume_set", {
                "entity_id": entity_id, "volume_level": msg["volume"],
            }, blocking=True, context=context)
        await hass.services.async_call("media_player", "play_media", {
            "entity_id": entity_id,
            "media_content_id": media_id,
            "media_content_type": "music",
        }, blocking=True, context=context)
        play_ms = round((monotonic() - started) * 1000) - convert_ms
        total_ms = round((monotonic() - started) * 1000)
        metrics = {"transfer_ms": transfer_ms, "convert_ms": convert_ms, "service_ms": play_ms, "processing_ms": total_ms}
        _LOGGER.info("P2Talk [%s] sent to %s (%d bytes, upload=%dms, ffmpeg=%dms, HA_services=%dms)",
                     tag, entity_id, size, transfer_ms, convert_ms, play_ms)
        connection.send_result(msg["id"], {"speaker": entity_id, "performance": metrics})
    except AudioError as err:
        _LOGGER.warning("P2Talk [%s] conversion failed, target=%s: %s", tag, entity_id, err)
        connection.send_error(msg["id"], "audio_error", str(err))
    except Exception:
        _LOGGER.exception("P2Talk [%s] playback failed, target=%s", tag, entity_id)
        connection.send_error(msg["id"], "playback_failed", "Không phát được trên loa. Kiểm tra log và URL nội bộ của Home Assistant.")
    finally:
        runtime.processing_users.discard(connection.user.id)
        upload.content.clear()


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/stop",
    vol.Required("speaker"): str,
})
@websocket_api.async_response
async def ws_stop(hass: HomeAssistant, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None or _selected_speaker(hass, runtime, connection, msg) is None:
        return
    try:
        await hass.services.async_call("media_player", "media_stop", {"entity_id": msg["speaker"]},
                                       blocking=True, context=connection.context(msg))
        connection.send_result(msg["id"])
        _LOGGER.debug("P2Talk playback stopped: %s", msg["speaker"])
    except Exception:
        _LOGGER.exception("P2Talk stop failed: %s", msg["speaker"])
        connection.send_error(msg["id"], "stop_failed", "Không dừng được loa")


def register_commands(hass: HomeAssistant) -> None:
    """WebSocket command registrations live for HA's process lifetime."""
    if hass.data.get(_REGISTERED_KEY):
        return
    for command in (ws_speakers, ws_upload_start, ws_upload_chunk,
                    ws_upload_finish, ws_upload_cancel, ws_stop):
        websocket_api.async_register_command(hass, command)
    hass.data[_REGISTERED_KEY] = True
