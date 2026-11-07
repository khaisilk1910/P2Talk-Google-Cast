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


def _selected_speaker(hass, runtime, connection, msg, entity=None):
    """Check configured allowlist, user control permission and availability."""
    entity = entity if entity is not None else msg["speaker"]
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


def _requested_speakers(connection, msg) -> list[str] | None:
    """Accept old single-speaker calls and new bounded multi-speaker calls."""
    entities = msg.get("speakers")
    if entities is None:
        entity = msg.get("speaker")
        entities = [entity] if entity else []
    if not entities or len(entities) > 32 or len(set(entities)) != len(entities):
        connection.send_error(msg["id"], "invalid_speakers", "Chọn từ 1 đến 32 loa, không trùng lặp.")
        return None
    return entities


def _validate_speakers(hass, runtime, connection, msg, *, require_play: bool):
    """Reject the entire request before playback unless EVERY target is allowed."""
    entities = _requested_speakers(connection, msg)
    if entities is None:
        return None
    states = {}
    for entity in entities:
        state = _selected_speaker(hass, runtime, connection, msg, entity)
        if state is None:
            return None
        if require_play and not (int(state.attributes.get("supported_features") or 0) & MediaPlayerEntityFeature.PLAY_MEDIA):
            connection.send_error(msg["id"], "unsupported", f"Loa {entity} không hỗ trợ play_media.")
            return None
        states[entity] = state
    return states


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
        available = bool(state and state.state not in ("unknown", "unavailable") and _can_control(connection, entity_id))
        speakers.append({
            "entity_id": entity_id,
            "friendly_name": item["name"] or (state.name if state else entity_id),
            "configured_name": item["name"],
            "state": state.state if state else "not_found",
            "is_available": available and bool(features & MediaPlayerEntityFeature.PLAY_MEDIA),
            "can_control": _can_control(connection, entity_id),
            "volume_level": state.attributes.get("volume_level") if state else None,
            "configured_volume": item["volume"] if item["volume"] is not None else runtime.entry.options.get(CONF_DEFAULT_VOLUME, DEFAULTS[CONF_DEFAULT_VOLUME]),
            "supports_stop": bool(features & MediaPlayerEntityFeature.STOP),
            "supports_pause": bool(features & MediaPlayerEntityFeature.PAUSE),
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
    vol.Optional("speaker"): str,  # Backward-compatible older panels
    vol.Optional("speakers"): vol.All([str], vol.Length(min=1, max=32)),
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
    states = _validate_speakers(hass, runtime, connection, msg, require_play=True)
    if states is None:
        upload.content.clear()
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
    entities = list(states)
    try:
        async with runtime.convert_semaphore:
            media_id = await async_convert(hass, bytes(upload.content), runtime.entry.options, upload.mime_type)
        convert_ms = round((monotonic() - started) * 1000)
        upload.content.clear()
        if not runtime.active:
            connection.send_error(msg["id"], "not_loaded", "Integration unloaded")
            return
        context = connection.context(msg)

        async def send_to_speaker(entity_id: str) -> tuple[str, bool]:
            # Recheck after conversion: entities, permissions and state may change.
            if speaker_by_id(runtime.entry.options, entity_id) is None or not _can_control(connection, entity_id):
                return entity_id, False
            state = hass.states.get(entity_id)
            if state is None or state.state in ("unknown", "unavailable"):
                return entity_id, False
            features = int(state.attributes.get("supported_features") or 0)
            if not features & MediaPlayerEntityFeature.PLAY_MEDIA:
                return entity_id, False
            try:
                current_volume = state.attributes.get("volume_level")
                if features & MediaPlayerEntityFeature.VOLUME_SET and (
                    not isinstance(current_volume, (int, float)) or abs(current_volume - msg["volume"]) > 0.02
                ):
                    await hass.services.async_call("media_player", "volume_set", {
                        "entity_id": entity_id, "volume_level": msg["volume"],
                    }, blocking=True, context=context)
                await hass.services.async_call("media_player", "play_media", {
                    "entity_id": entity_id,
                    "media_content_id": media_id,
                    "media_content_type": "music",
                }, blocking=True, context=context)
                return entity_id, True
            except Exception:
                _LOGGER.exception("P2Talk [%s] playback failed, target=%s", tag, entity_id)
                return entity_id, False

        # Issue playback requests concurrently so speakers start as close together
        # as their Google Cast / Home Assistant latencies allow. No sync guarantee.
        results = await asyncio.gather(*(send_to_speaker(entity) for entity in entities))
        succeeded = [entity for entity, ok in results if ok]
        failed = [entity for entity, ok in results if not ok]
        play_ms = round((monotonic() - started) * 1000) - convert_ms
        total_ms = round((monotonic() - started) * 1000)
        metrics = {"transfer_ms": transfer_ms, "convert_ms": convert_ms, "service_ms": play_ms, "processing_ms": total_ms}
        _LOGGER.info("P2Talk [%s] sent to %d/%d speakers (%d bytes, upload=%dms, ffmpeg=%dms, HA_services=%dms)",
                     tag, len(succeeded), len(entities), size, transfer_ms, convert_ms, play_ms)
        if not succeeded:
            connection.send_error(msg["id"], "playback_failed", "Không phát được trên loa đã chọn. Kiểm tra trạng thái loa và log Home Assistant.")
        else:
            connection.send_result(msg["id"], {
                "speaker": succeeded[0],  # Retained for older clients
                "speakers": succeeded, "failed_speakers": failed, "performance": metrics,
            })
    except AudioError as err:
        _LOGGER.warning("P2Talk [%s] conversion failed: %s", tag, err)
        connection.send_error(msg["id"], "audio_error", str(err))
    except Exception:
        _LOGGER.exception("P2Talk [%s] playback request failed", tag)
        connection.send_error(msg["id"], "playback_failed", "Không thể xử lý bản ghi âm. Kiểm tra log Home Assistant.")
    finally:
        runtime.processing_users.discard(connection.user.id)
        upload.content.clear()


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/stop",
    vol.Optional("speaker"): str,
    vol.Optional("speakers"): vol.All([str], vol.Length(min=1, max=32)),
})
@websocket_api.async_response
async def ws_stop(hass: HomeAssistant, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    entities = _requested_speakers(connection, msg)
    if entities is None:
        return
    # Validate the full allowlist/ACL before acting on any target; unlike play,
    # one disconnected speaker must not prevent stopping all the other speakers.
    for entity_id in entities:
        if speaker_by_id(runtime.entry.options, entity_id) is None:
            connection.send_error(msg["id"], "not_configured", f"Loa {entity_id} không nằm trong P2Talk.")
            return
        if not _can_control(connection, entity_id):
            connection.send_error(msg["id"], "unauthorized", "Không có quyền điều khiển một trong các loa.")
            return
    context = connection.context(msg)

    async def stop_one(entity_id: str) -> tuple[str, str]:
        """Use the same supported-feature contract as HA media-player controls.

        'already_stopped' is idempotent. A non-STOP device may be PAUSE-able;
        report that explicitly rather than pretending media_stop succeeded.
        """
        if not runtime.active or speaker_by_id(runtime.entry.options, entity_id) is None or not _can_control(connection, entity_id):
            return entity_id, "not_allowed"
        state = hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable"):
            return entity_id, "offline"
        # Cast can be idle/off by the time an action is processed; don't call
        # media_stop in a state that no longer has media to stop.
        if state.state in ("idle", "off", "standby"):
            return entity_id, "already_stopped"
        features = int(state.attributes.get("supported_features") or 0)
        if features & MediaPlayerEntityFeature.STOP:
            action, result = "media_stop", "stopped"
        elif features & MediaPlayerEntityFeature.PAUSE:
            action, result = "media_pause", "paused"
        else:
            return entity_id, "unsupported"
        try:
            # Home Assistant's service target follows the same path as native
            # media-player controls; no direct Cast API or supervisor calls.
            await hass.services.async_call(
                "media_player", action, {}, blocking=True,
                context=context, target={"entity_id": entity_id},
            )
            return entity_id, result
        except Exception:
            _LOGGER.exception("P2Talk %s failed: %s", action, entity_id)
            return entity_id, "service_error"

    results = await asyncio.gather(*(stop_one(entity) for entity in entities))
    succeeded = [entity for entity, result in results if result in ("stopped", "already_stopped", "paused")]
    paused = [entity for entity, result in results if result == "paused"]
    already = [entity for entity, result in results if result == "already_stopped"]
    failed = [entity for entity, result in results if result not in ("stopped", "already_stopped", "paused")]
    if failed:
        _LOGGER.warning("P2Talk stop: %d/%d speaker(s) could not be stopped; reasons=%s",
                        len(failed), len(entities),
                        {entity: reason for entity, reason in results if entity in failed})
    if not succeeded:
        connection.send_error(
            msg["id"], "stop_failed",
            "Không thể dừng loa đã chọn. Kiểm tra trạng thái/kết nối và khả năng STOP hoặc PAUSE.",
        )
    else:
        connection.send_result(msg["id"], {
            "speakers": succeeded,
            "already_stopped_speakers": already,
            "paused_speakers": paused,
            "failed_speakers": failed,
            "failure_reasons": {entity: result for entity, result in results if entity in failed},
        })
        _LOGGER.debug("P2Talk stopped %d/%d selected speakers", len(succeeded), len(entities))


def register_commands(hass: HomeAssistant) -> None:
    """WebSocket command registrations live for HA's process lifetime."""
    if hass.data.get(_REGISTERED_KEY):
        return
    for command in (ws_speakers, ws_upload_start, ws_upload_chunk,
                    ws_upload_finish, ws_upload_cancel, ws_stop):
        websocket_api.async_register_command(hass, command)
    hass.data[_REGISTERED_KEY] = True
