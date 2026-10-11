"""Local development HTTP entry. Production TLS/reverse proxy is not configured here."""
import argparse
import hmac
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from reading import Reading, WeRead
from hermes import Hermes
from service import Service
from store import Fault, Store, encoded

logger = logging.getLogger('hermeseye.server')


def handler(service, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # URLs and bodies may contain private data; no access/body logging.

        def do_GET(self):
            self.dispatch()

        def do_POST(self):
            self.dispatch()

        def dispatch(self):
            try:
                if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                    raise Fault(401, 'unauthorized')
                url = urlsplit(self.path)
                query = parse_qs(url.query)
                body = None
                if self.command == 'POST':
                    if self.headers.get('Transfer-Encoding'):
                        raise Fault(400, 'transfer_encoding_unsupported')
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 131072:
                        raise Fault(413, 'body_limit')
                    self.connection.settimeout(10)
                    body = json.loads(self.rfile.read(length))
                    if not isinstance(body, dict):
                        raise Fault(400, 'invalid_body')
                path = url.path
                if path == '/eye/v1/capabilities' and self.command == 'GET':
                    result = service.capabilities()
                elif path.startswith('/eye/v1/reading'):
                    reading = service.reading
                    if reading is None:
                        raise Fault(503, 'reading_not_configured')
                    if path == '/eye/v1/reading' and self.command == 'GET':
                        result = reading.list()
                    elif path == '/eye/v1/reading/policy' and self.command == 'POST':
                        result = reading.configure(body)
                    elif path == '/eye/v1/reading/collect' and self.command == 'POST':
                        if set(body) != {'cycleId'}:
                            raise Fault(400, 'invalid_reading_cycle')
                        result = reading.cycle(body['cycleId'])
                    elif path == '/eye/v1/reading/questions' and self.command == 'POST':
                        result = reading.question(body)
                    elif path == '/eye/v1/reading/answer' and self.command == 'POST':
                        result = reading.answer(body)
                    else:
                        raise Fault(404, 'not_found')
                elif path == '/eye/v1/mutations' and self.command == 'POST':
                    result = service.store.mutate(body)
                elif path == '/eye/v1/sync' and self.command == 'GET':
                    result = service.store.sync(int(query.get('cursor', ['0'])[0]), int(query.get('limit', ['100'])[0]))
                elif path == '/eye/v1/snapshot' and self.command == 'GET':
                    result = service.store.snapshot()
                elif path == '/eye/v1/operations' and self.command == 'POST':
                    result = service.submit(body)
                elif path.startswith('/eye/v1/operations/'):
                    parts = path.removeprefix('/eye/v1/operations/').split('/')
                    if len(parts) == 1 and self.command == 'GET':
                        result = service.refresh(parts[0])
                    elif len(parts) == 2 and parts[1] == 'events' and self.command == 'GET':
                        after = int(query.get('after', ['0'])[0])
                        if after < 0:
                            raise Fault(400, 'invalid_cursor')
                        result = {'events': service.store.events(parts[0], after)}
                    elif len(parts) == 2 and parts[1] == 'stop' and self.command == 'POST':
                        result = service.stop(parts[0])
                    else:
                        raise Fault(404, 'not_found')
                else:
                    raise Fault(404, 'not_found')
                self.reply(200, result)
            except Fault as error:
                self.reply(error.status, {'error': error.code, 'details': error.details})
            except (ValueError, TypeError, KeyError, UnicodeError):
                self.reply(400, {'error': 'invalid_request'})
            except Exception as error:
                # 只记录方法、路径与异常类型：查询串、请求体与上游 message 都可能含私有数据。
                logger.error('未处理请求异常 method=%s path=%s 错误类型=%s',
                             self.command, urlsplit(self.path).path, type(error).__name__)
                self.reply(500, {'error': 'internal_error'})

        def reply(self, code, body):
            data = encoded(body).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass  # 客户端已断开，响应无法送达，重试没有意义。
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--data', default='backend/.local/workspace.sqlite')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
    os.umask(0o077)
    token = os.environ.get('HERMES_EYE_TOKEN', '')
    if len(token) < 32:
        parser.error('HERMES_EYE_TOKEN must contain at least 32 characters')
    os.makedirs(os.path.dirname(os.path.abspath(args.data)), exist_ok=True)
    # Only one process owns an event collector and this workspace database.
    import fcntl
    lock = open(args.data + '.lock', 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error('workspace already opened by another service process')
    root, upstream_token = os.environ.get('HERMES_ROOT'), os.environ.get('HERMES_TOKEN')
    if bool(root) != bool(upstream_token):
        parser.error('HERMES_ROOT and HERMES_TOKEN must be configured together')
    if upstream_token and hmac.compare_digest(token, upstream_token):
        parser.error('business and upstream credentials must differ')
    store = Store(args.data, os.environ.get('HERMES_EYE_WORKSPACE', 'personal'))
    service = Service(store, Hermes(root, upstream_token) if root else None,
                      os.environ.get('HERMES_EYE_ENABLE_RUNS') == '1')
    source_token = os.environ.get('WEREAD_API_KEY', '')
    service.reading = Reading(store, service, WeRead(source_token) if source_token else None)
    service.reading.start()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(service, token))
    logger.info('HermesEye 业务服务已在回环地址监听 port=%d', args.port)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        service.reading.stop()
        store.close()
        lock.close()


if __name__ == '__main__':
    main()
