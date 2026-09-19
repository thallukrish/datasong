import atexit
import json
import os
import sys
import threading
from datetime import datetime, timezone

_LOCK = threading.Lock()
_FILE = None
_ENABLED = False


def _env(name, default=''):
    return str(os.getenv(name, default) or '').strip()


def _addon_from_filename(filename):
    normalized = str(filename or '').replace('\\', '/')
    marker = '/addons/'
    at = normalized.find(marker)
    if at < 0:
        return ''
    rest = normalized[at + len(marker):]
    return rest.split('/', 1)[0] if rest else ''


def _frame_model(frame):
    try:
        self_obj = frame.f_locals.get('self')
        return str(getattr(self_obj, '_name', '') or '')
    except Exception:
        return ''


def _write(event):
    global _FILE
    if _FILE is None:
        path = _env('LEMAP_RUNTIME_TRACE_FILE')
        if not path:
            return
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        _FILE = open(path, 'a', encoding='utf-8', buffering=1)
    with _LOCK:
        _FILE.write(json.dumps(event, separators=(',', ':')) + '\n')


def _profile(frame, event, arg):
    if event != 'call':
        return
    filename = str(frame.f_code.co_filename or '')
    normalized = filename.replace('\\', '/')
    # Inherited ORM methods execute in Odoo core rather than add-on files.
    is_addon = '/addons/' in normalized
    is_core_orm = (
        '/odoo/' in normalized
        and not is_addon
        and frame.f_code.co_name in {'create', 'search', 'search_read', 'read', 'write', 'unlink'}
    )
    if not is_addon and not is_core_orm:
        return

    model = _frame_model(frame)
    if not model or (is_core_orm and not model.startswith('acme.')):
        return

    caller = frame.f_back
    caller_model = _frame_model(caller) if caller else ''
    caller_method = str(caller.f_code.co_name or '') if caller else ''

    _write({
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'enterpriseId': _env('LEMAP_ENTERPRISE_ID'),
        'scenarioId': _env('LEMAP_SCENARIO_ID'),
        'sessionId': _env('LEMAP_SESSION_ID'),
        'model': model,
        'method': str(frame.f_code.co_name or ''),
        'addon': _addon_from_filename(filename),
        'source': normalized,
        'callerModel': caller_model,
        'callerMethod': caller_method,
    })


def _close():
    global _FILE
    try:
        if _FILE is not None:
            _FILE.close()
    finally:
        _FILE = None


def post_load():
    global _ENABLED
    if _ENABLED:
        return
    if _env('LEMAP_RUNTIME_TRACE').lower() not in {'1', 'true', 'yes', 'on'}:
        return
    if not _env('LEMAP_RUNTIME_TRACE_FILE'):
        return
    _ENABLED = True
    atexit.register(_close)
    sys.setprofile(_profile)
    threading.setprofile(_profile)
