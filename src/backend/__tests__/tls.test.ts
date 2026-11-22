import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPanelListener, type PanelListener } from '../tls';

/** Certyfikat testowy z openssl (ten sam sposób co w install.sh); bez openssl test jest pomijany. */
function makeCert(dir: string): { cert: string; key: string } | null {
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-days', '1', '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    return { cert, key };
  } catch {
    return null;
  }
}

const dir = mkdtempSync(join(tmpdir(), 'shtls-'));
const tls = makeCert(dir);

describe.skipIf(!tls)('HTTPS panelu', () => {
  let panel: PanelListener;
  let port = 0;

  beforeAll(async () => {
    panel = createPanelListener((_req, res) => res.end('panel'), tls!);
    await new Promise<void>((r) => panel.listener.listen(0, '127.0.0.1', r));
    port = (panel.listener.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((r) => panel.listener.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it('obsługuje HTTPS', async () => {
    const body = await new Promise<string>((resolve, reject) => {
      httpsGet({ host: '127.0.0.1', port, path: '/', rejectUnauthorized: false }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    expect(body).toBe('panel');
  });

  it('zwykłe HTTP na tym samym porcie dostaje tylko przekierowanie na HTTPS', async () => {
    const res = await new Promise<{ status?: number; location?: string; body: string }>((resolve, reject) => {
      httpGet({ host: '127.0.0.1', port, path: '/api/devices?x=1' }, (r) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => resolve({ status: r.statusCode, location: r.headers.location, body: data }));
      }).on('error', reject);
    });
    expect(res.status).toBe(301);
    expect(res.location).toBe(`https://127.0.0.1:${port}/api/devices?x=1`);
    expect(res.body).not.toContain('panel');
  });
});
