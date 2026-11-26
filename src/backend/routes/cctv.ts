import { Router, type Response } from 'express';
import type { Backend } from '../context';
import { CctvValidationError, MAX_CAMERAS } from '../cctv/service';

const AUDIT_DEVICE = { ieee_address: 'cctv', friendly_name: 'CCTV' };

/** Kamery RTSP: lista, dodawanie, edycja, kolejność i sprawdzenie połączenia. Obraz idzie przez /ws/cctv. */
export function cctvRouter(b: Backend): Router {
  const r = Router();
  const cctv = b.cctv;

  const fail = (res: Response, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err instanceof CctvValidationError ? 400 : 500).json({ success: false, message });
  };

  r.get('/api/cctv', (_req, res) => {
    res.json({ cameras: cctv.cameras(), max: MAX_CAMERAS, streams: cctv.status() });
  });

  r.post('/api/cctv/cameras', (req, res) => {
    try {
      const camera = cctv.add(req.body ?? {});
      b.registry.audit('control', AUDIT_DEVICE, `CCTV: dodano kamerę „${camera.name}”`);
      res.json({ success: true, camera, cameras: cctv.cameras() });
    } catch (err) {
      fail(res, err);
    }
  });

  r.put('/api/cctv/cameras/:id', (req, res) => {
    try {
      const camera = cctv.update(req.params['id'], req.body ?? {});
      b.registry.audit('control', AUDIT_DEVICE, `CCTV: zmieniono kamerę „${camera.name}”`);
      res.json({ success: true, camera, cameras: cctv.cameras() });
    } catch (err) {
      fail(res, err);
    }
  });

  r.delete('/api/cctv/cameras/:id', (req, res) => {
    const cam = cctv.cameras().find((c) => c.id === req.params['id']);
    cctv.remove(req.params['id']);
    if (cam) b.registry.audit('control', AUDIT_DEVICE, `CCTV: usunięto kamerę „${cam.name}”`);
    res.json({ success: true, cameras: cctv.cameras() });
  });

  r.post('/api/cctv/reorder', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    res.json({ success: true, cameras: cctv.reorder(ids) });
  });

  r.post('/api/cctv/test', async (req, res) => {
    const url = String(req.body?.url ?? '');
    const id = typeof req.body?.id === 'string' ? req.body.id : undefined;
    res.json(await cctv.test({ id, url }));
  });

  return r;
}
