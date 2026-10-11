/**
 * Moduł bezpośredniego sterowania Sonoff LAN w przeglądarce (Direct Browser Client)
 * Wykorzystuje Web Crypto API (SubtleCrypto) do natywnego AES-128-CBC i MD5
 * bez konieczności przechodzenia przez serwer proxy ani zewnętrzne biblioteki.
 */

/**
 * Wyliczanie MD5 zgodne z RFC 1321 do klucza AES (MD5(DeviceKey))
 */
function md5(input: string): Uint8Array {
  function safeAdd(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }

  function bitRotateLeft(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }

  function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }

  function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }

  function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }

  function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }

  function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  function binlMD5(x: number[], len: number): Uint8Array {
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;

    let a = 1732584193;
    let b = -271733879;
    let c = -1732584194;
    let d = 271733878;

    for (let i = 0; i < x.length; i += 16) {
      const olda = a;
      const oldb = b;
      const oldc = c;
      const oldd = d;

      a = md5ff(a, b, c, d, x[i], 7, -680876936);
      d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
      b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
      d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
      b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
      d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
      b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
      d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
      b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);

      a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
      d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
      b = md5gg(b, c, d, a, x[i], 20, -373897302);
      a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
      d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
      b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
      d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
      b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
      d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
      b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);

      a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
      d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
      b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
      d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
      b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
      d = md5hh(d, a, b, c, x[i], 11, -358537222);
      c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
      b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
      d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
      b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);

      a = md5ii(a, b, c, d, x[i], 6, -198630844);
      d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
      b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
      d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
      b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
      d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
      b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
      d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
      b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);

      a = safeAdd(a, olda);
      b = safeAdd(b, oldb);
      c = safeAdd(c, oldc);
      d = safeAdd(d, oldd);
    }

    const words = [a, b, c, d];
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      out[i] = (words[i >> 2] >>> ((i % 4) * 8)) & 0xff;
    }
    return out;
  }

  const utf8 = new TextEncoder().encode(input);
  const words: number[] = [];
  for (let i = 0; i < utf8.length; i++) {
    words[i >> 2] |= utf8[i] << ((i % 4) * 8);
  }
  return binlMD5(words, utf8.length * 8) as unknown as Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Szyfrowanie payloadu algorytmem AES-128-CBC dla eWeLink Zeroconf LAN
 */
async function encryptBrowserPayload(dataObj: Record<string, unknown>, deviceKey: string): Promise<{ data: string; iv: string }> {
  const jsonStr = JSON.stringify(dataObj);
  const keyBytes = md5(deviceKey.trim());
  const ivBytes = new Uint8Array(16);
  crypto.getRandomValues(ivBytes);

  // Bezpieczne skopiowanie bufora jako ArrayBuffer
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-CBC' },
    false,
    ['encrypt']
  );

  const encodedData = new TextEncoder().encode(jsonStr);
  const encryptedBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: ivBytes },
    cryptoKey,
    encodedData
  );

  return {
    data: toBase64(new Uint8Array(encryptedBuf)),
    iv: toBase64(ivBytes),
  };
}

/**
 * Bezpośrednie wysłanie polecenia HTTP z przeglądarki do urządzenia w lokalnej podsieci
 */
export async function directBrowserSonoffCommand(options: {
  ip: string;
  deviceId?: string;
  deviceKey?: string;
  state: 'on' | 'off';
  timeoutMs?: number;
}): Promise<{ success: boolean; message: string }> {
  if (typeof window === 'undefined' || !window.fetch) {
    return { success: false, message: 'Brak środowiska przeglądarki (Direct Fetch niedostępny na SSR).' };
  }

  const { ip, deviceId, deviceKey, state } = options;
  const timeoutMs = options.timeoutMs ?? 2500;
  const url = `http://${ip}:8081/zeroconf/switch`;
  const sequence = Date.now().toString();

  const payloadData = {
    switch: state,
    switches: [{ switch: state, outlet: 0 }],
  };

  let body: Record<string, unknown>;

  if (deviceKey && deviceKey.trim().length > 0) {
    try {
      const enc = await encryptBrowserPayload(payloadData, deviceKey.trim());
      body = {
        sequence,
        deviceid: deviceId || '',
        selfApikey: '123',
        encrypt: true,
        data: enc.data,
        iv: enc.iv,
      };
    } catch (e) {
      return { success: false, message: `Błąd szyfrowania AES w przeglądarce: ${e}` };
    }
  } else {
    body = {
      sequence,
      deviceid: deviceId || '',
      selfApikey: '123',
      encrypt: false,
      data: payloadData,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      mode: 'cors',
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { success: false, message: `Odpowiedź HTTP ${res.status} z ${ip}:8081` };
    }

    const data = await res.json().catch(() => null);
    if (data && data.error === 0) {
      return { success: true, message: `[Direct Browser LAN] Pomyślnie przestawiono Sonoff (${ip}) na ${state.toUpperCase()}!` };
    }
    return { success: false, message: `Urządzenie Sonoff zwróciło kod ${data?.error}` };
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Brak bezpośredniej łączności z ${ip}:8081 (${msg})` };
  }
}
