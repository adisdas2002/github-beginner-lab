// Small fetch helpers, including a reader for the server's event streams.

async function errorMessage(res) {
  try {
    const body = await res.json();
    return body.error || res.statusText;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function sendJSON(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

function parseEvent(chunk) {
  let event = 'message';
  const data = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

// POST a JSON body and call onEvent(name, data) for each server-sent event.
export async function postStream(url, body, { signal, onEvent }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const parsed = parseEvent(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      if (parsed) onEvent(parsed.event, parsed.data);
    }
  }
  if (buffer.trim()) {
    const parsed = parseEvent(buffer);
    if (parsed) onEvent(parsed.event, parsed.data);
  }
}
