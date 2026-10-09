"""Official Hermes v2026.6.19 adapter. No automatic request retries."""
import json
import urllib.error
import urllib.parse
import urllib.request
from store import Fault


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Hermes:
    def __init__(self, root, token):
        url = urllib.parse.urlsplit(root)
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.query or url.fragment:
            raise ValueError('Invalid Hermes service root')
        if url.scheme == 'http' and url.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('Use HTTPS outside loopback')
        if url.path.rstrip('/').endswith('/v1'):
            raise ValueError('Use service root, without /v1')
        self.root, self.token = root.rstrip('/'), token
        self.opener = urllib.request.build_opener(NoRedirect)

    def open(self, path, body=None):
        req = urllib.request.Request(self.root + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            return self.opener.open(req, timeout=60)
        except urllib.error.HTTPError as error:
            raise Fault(502, 'upstream_http_' + str(error.code)) from None
        except (OSError, ValueError):
            raise Fault(502, 'upstream_unavailable') from None

    def request(self, path, body=None):
        with self.open(path, body) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise Fault(502, 'upstream_response_too_large')
            try:
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError()
                return value
            except (ValueError, UnicodeError):
                raise Fault(502, 'invalid_upstream_response') from None

    def events(self, run):
        with self.open('/v1/runs/' + urllib.parse.quote(run, safe='') + '/events') as response:
            data = []
            size = 0
            while True:
                raw = response.readline(65537)
                if not raw:
                    break
                size += len(raw)
                if size > 1024 * 1024 or len(raw) > 65536:
                    raise Fault(502, 'event_limit')
                line = raw.decode('utf-8').rstrip('\r\n')
                if not line:
                    if data:
                        text = '\n'.join(data)
                        if text != '[DONE]':
                            yield json.loads(text)
                        data, size = [], 0
                elif line.startswith('data:'):
                    data.append(line[5:].lstrip())
