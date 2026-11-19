let token = localStorage.getItem('zw_token');
export const getToken = () => token;
export const setToken = (t) => { token = t; t ? localStorage.setItem('zw_token', t) : localStorage.removeItem('zw_token'); };

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, {
    method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && token && path !== '/auth/login') { setToken(null); window.dispatchEvent(new Event('zw-logout')); }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function download(path, fallbackName) {
  const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Download failed');
  const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
