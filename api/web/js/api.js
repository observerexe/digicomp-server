export class ApiError extends Error {
  constructor(status, body) {
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message || 'Помилка запиту';
    super(message);
    this.status = status;
    this.errorCode = body?.errorCode || 'ERROR';
    this.body = body;
  }
}

let refreshing = null;
let onSessionLost = () => {};
export function setSessionLostHandler(fn) { onSessionLost = fn; }

async function raw(method, path, body, isForm) {
  const headers = { 'X-DC-Client': 'web' };
  let payload;
  if (body !== undefined) {
    if (isForm) payload = body;
    else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, { errorCode: 'NETWORK', message: 'Немає зв’язку із сервером' });
  }
  return res;
}

async function parse(res) {
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

async function refreshSession() {
  if (!refreshing) {
    refreshing = raw('POST', '/auth/refresh', {}).then((r) => r.ok).catch(() => false).finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function request(method, path, body, isForm = false) {
  let res = await raw(method, path, body, isForm);
  const isAuthCall = path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
  if (res.status === 401 && !isAuthCall) {
    if (await refreshSession()) res = await raw(method, path, body, isForm);
    if (res.status === 401) { onSessionLost(); }
  }
  return parse(res);
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  upload: (path, form) => request('POST', path, form, true),
};

export function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}
