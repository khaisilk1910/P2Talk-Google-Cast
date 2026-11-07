"""Exercise the actual ws_stop function without requiring an HA installation."""
from __future__ import annotations

import ast
import asyncio
import copy
from pathlib import Path
import types
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'custom_components/p2talk_google_cast/websocket.py'
source = ast.parse(MODULE.read_text())
node = next(n for n in source.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'ws_stop')
node = copy.deepcopy(node)
node.decorator_list = []

class Features:
    STOP = 4096
    PAUSE = 1

class State:
    def __init__(self, state, flags=0):
        self.state = state
        self.attributes = {'supported_features': flags}

class Connection:
    def __init__(self, denied=None):
        self.user = types.SimpleNamespace(is_admin=False, permissions=types.SimpleNamespace(
            check_entity=lambda entity, policy: entity != denied))
        self.result = None
        self.error = None
    def send_result(self, _id, result): self.result = result
    def send_error(self, _id, code, message): self.error = (code, message)
    def context(self, msg): return 'context'

class Services:
    def __init__(self, broken=None):
        self.calls = []
        self.broken = broken
    async def async_call(self, domain, action, data, **kwargs):
        self.calls.append((domain, action, data, kwargs))
        if kwargs['target']['entity_id'] == self.broken: raise RuntimeError('device error')

class StopWebsocketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = types.SimpleNamespace(active=True, entry=types.SimpleNamespace(
            options={'speakers': [{'entity_id': f'media_player.{n}'} for n in 'abcd']}))
        self.states = {
            'media_player.a': State('playing', Features.STOP),
            'media_player.b': State('paused', Features.PAUSE),
            'media_player.c': State('idle', Features.STOP),
            'media_player.d': State('unavailable', Features.STOP),
        }
        self.services = Services()
        self.hass = types.SimpleNamespace(states=self.states, services=self.services)
        self.connection = Connection()
        env = {
            'HomeAssistant': object,
            'asyncio': asyncio,
            'MediaPlayerEntityFeature': Features,
            '_runtime': lambda hass, conn, msg: self.runtime,
            '_requested_speakers': lambda conn, msg: msg['speakers'],
            'speaker_by_id': lambda opts, entity: next((x for x in opts['speakers'] if x['entity_id'] == entity), None),
            '_can_control': lambda conn, entity: conn.user.permissions.check_entity(entity, 'control'),
            '_LOGGER': types.SimpleNamespace(exception=lambda *args: None, debug=lambda *args: None, warning=lambda *args: None),
        }
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(MODULE), 'exec'), env)
        self.stop = env['ws_stop']

    async def test_stop_supported_with_target_and_pause_fallback(self):
        await self.stop(self.hass, self.connection, {'id':1,'speakers':['media_player.a','media_player.b','media_player.c','media_player.d']})
        self.assertEqual(self.connection.result['speakers'], ['media_player.a','media_player.b','media_player.c'])
        self.assertEqual(self.connection.result['paused_speakers'], ['media_player.b'])
        self.assertEqual(self.connection.result['already_stopped_speakers'], ['media_player.c'])
        self.assertEqual(self.connection.result['failed_speakers'], ['media_player.d'])
        self.assertEqual([(c[0], c[1], c[3]['target']) for c in self.services.calls], [
            ('media_player', 'media_stop', {'entity_id': 'media_player.a'}),
            ('media_player', 'media_pause', {'entity_id': 'media_player.b'}),
        ])
        self.assertTrue(all(c[3]['blocking'] is True for c in self.services.calls))

    async def test_one_failed_service_does_not_prevent_other_speaker(self):
        self.services.broken = 'media_player.a'
        await self.stop(self.hass, self.connection, {'id':1,'speakers':['media_player.a','media_player.c']})
        self.assertEqual(self.connection.result['speakers'], ['media_player.c'])
        self.assertEqual(self.connection.result['failure_reasons'], {'media_player.a':'service_error'})

    async def test_all_offline_returns_error(self):
        await self.stop(self.hass, self.connection, {'id':1,'speakers':['media_player.d']})
        self.assertEqual(self.connection.error[0], 'stop_failed')
        self.assertEqual(self.services.calls, [])

    async def test_permission_denied_aborts_all_before_service(self):
        self.connection = Connection(denied='media_player.b')
        await self.stop(self.hass, self.connection, {'id':1,'speakers':['media_player.a', 'media_player.b']})
        self.assertEqual(self.connection.error[0], 'unauthorized')
        self.assertEqual(self.services.calls, [])

if __name__ == '__main__': unittest.main()
