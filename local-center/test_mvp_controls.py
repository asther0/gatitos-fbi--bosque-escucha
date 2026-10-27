"""Exercise the operator flow without pretending to validate physical hardware."""
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
import mvp_controls as controls


class MVPTests(unittest.TestCase):
    def setUp(self):
        mask = patch.object(controls, 'wifi_mask', return_value='255.255.255.0')
        mask.start()
        self.addCleanup(mask.stop)
        self.app = FastAPI()
        def auth(request: Request):
            if request.headers.get('authorization') != 'Bearer test-token':
                raise HTTPException(401)
        @contextmanager
        def connect():
            yield None
        self.reads = 0
        def rows(c, table):
            self.reads += 1
            return [] if self.reads == 1 else [{'id': 'fresh-capture', 'node_id': 'DEMO-ESP32-WIFI'}]
        controls.install_controls(self.app, auth, 'test-token', connect, rows)
        self.client = TestClient(self.app, client=('127.0.0.1', 1000))
        self.headers = {'Authorization': 'Bearer test-token'}

    def test_hardware_controls_require_auth_and_local_connection(self):
        self.assertEqual(self.client.post('/api/mvp/action', json={'action': 'test'}).status_code, 401)
        with TestClient(self.app, client=('192.168.0.102', 1000)) as remote:
            self.assertEqual(remote.post('/api/mvp/action', headers=self.headers, json={'action': 'test'}).status_code, 403)

    def test_status_exposes_board_listening_and_network_mismatch(self):
        @contextmanager
        def board():
            yield 99, 'STATUS wifi=connected ip=192.168.0.101 center=192.168.0.100 auto=on protocol=2'
        with patch.object(controls, 'board', board), patch.object(controls, 'ports', return_value=['/dev/cu.usbserial-130']), patch.object(controls, 'wifi_ip', return_value='172.20.10.7'):
            response = self.client.get('/api/mvp/status?probe=true', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['listening'])
        self.assertFalse(response.json()['same_network'])

    def test_status_with_disconnected_board_does_not_claim_active_listening(self):
        with patch.object(controls, 'ports', return_value=[]), patch.object(controls, 'wifi_ip', return_value='172.20.10.7'), patch.object(controls, 'board') as board:
            response = self.client.get('/api/mvp/status?probe=true', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['listening'])
        board.assert_not_called()

    def test_test_sound_overlaps_wifi_capture_and_restores_auto(self):
        trace = []
        @contextmanager
        def board():
            yield 99, 'STATUS wifi=connected ip=192.168.0.101 center=192.168.0.100 auto=on'
        @contextmanager
        def sample():
            trace.append('play')
            yield
            trace.append('stop-sound')
        def write(fd, command):
            trace.append(command)
        def line(fd, prefixes, timeout):
            return 'UPLOAD_OK status=200' if prefixes == ('UPLOAD_OK',) else prefixes[0]
        with patch.object(controls, 'board', board), patch.object(controls, 'sample_playback', sample), patch.object(controls, 'wifi_ip', return_value='192.168.0.100'), patch.object(controls.os, 'write', write), patch.object(controls, 'wait_line', line):
            response = self.client.post('/api/mvp/action', headers=self.headers, json={'action': 'test'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['capture_id'], 'fresh-capture')
        self.assertEqual(trace, [b'D', 'play', b'W', 'stop-sound', b'E'])

    def test_wifi_mismatch_stops_before_capture(self):
        @contextmanager
        def board():
            yield 99, 'STATUS wifi=connected ip=192.168.0.101 center=192.168.0.100 auto=off'
        with patch.object(controls, 'board', board), patch.object(controls, 'wifi_ip', return_value='172.20.10.7'), patch.object(controls.os, 'write') as write:
            response = self.client.post('/api/mvp/action', headers=self.headers, json={'action': 'capture'})
        self.assertEqual(response.status_code, 409)
        write.assert_not_called()

    def test_laptop_address_is_updated_without_wifi_password(self):
        state = 'STATUS wifi=connected ip=192.168.0.100 center=192.168.0.100 auto=off protocol=2'
        with patch.object(controls, 'wifi_ip', return_value='192.168.0.101'), patch.object(controls.os, 'write') as write, patch.object(controls, 'wait_line', return_value='CENTER_UPDATED'):
            controls.align_center(99, state)
        write.assert_called_once_with(99, b'H\t192.168.0.101\n')

    def test_other_network_does_not_overwrite_center_address(self):
        state = 'STATUS wifi=connected ip=192.168.0.100 center=192.168.0.100 auto=off protocol=2'
        with patch.object(controls, 'wifi_ip', return_value='172.20.10.7'), patch.object(controls.os, 'write') as write:
            with self.assertRaises(HTTPException):
                controls.align_center(99, state)
        write.assert_not_called()

    def test_network_switch_waits_for_dhcp_before_rejecting(self):
        state = 'STATUS wifi=connected ip=192.168.0.100 center=192.168.0.100 auto=off protocol=2'
        with patch.object(controls, 'wifi_ip', side_effect=[None, None, '192.168.0.101']), patch.object(controls.time, 'sleep'), patch.object(controls.os, 'write') as write, patch.object(controls, 'wait_line', return_value='CENTER_UPDATED'):
            controls.align_center(99, state)
        write.assert_called_once_with(99, b'H\t192.168.0.101\n')

    def test_missing_dhcp_lease_explains_recovery_without_writing_serial(self):
        state = 'STATUS wifi=connected ip=192.168.0.100 center=192.168.0.100 auto=off protocol=2'
        with patch.object(controls, 'wifi_ip', return_value='169.254.10.20'), patch.object(controls.time, 'sleep'), patch.object(controls.os, 'write') as write:
            with self.assertRaises(HTTPException) as result:
                controls.align_center(99, state)
        self.assertIn('Renovar concesión DHCP', result.exception.detail)
        write.assert_not_called()

    def test_invalid_credentials_do_not_touch_serial(self):
        with patch.object(controls, 'wifi_ip', return_value='192.168.0.100'), patch.object(controls, 'board') as board:
            response = self.client.post('/api/mvp/configure', headers=self.headers, json={'ssid': 'bad\ncommand', 'password': 'secret'})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('secret', response.text)
        board.assert_not_called()


if __name__ == '__main__':
    unittest.main()
