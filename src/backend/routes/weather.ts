import { Router, type Response } from 'express';
import {
  getImgwFavoriteStations,
  getImgwHydroStations,
  getImgwLocationDetails,
  getImgwLocations,
  getImgwMeteoStations,
  getImgwStationHistory,
  getImgwSynopStationById,
  getImgwSynopStations,
  getImgwWarnings,
  setImgwFavoriteStations,
} from '../imgw';

/** Dane pogodowe IMGW-PIB (danepubliczne.imgw.pl). */
export function weatherRouter(): Router {
  const r = Router();
  const fail = (res: Response, what: string, err: unknown) =>
    res.status(502).json({ error: `Błąd pobierania danych IMGW (${what})`, details: String(err) });

  r.get('/api/weather/locations', async (req, res) => {
    try {
      res.json(await getImgwLocations(String(req.query['search'] ?? ''), String(req.query['voivodeship'] ?? 'all'), String(req.query['type'] ?? 'all')));
    } catch (err) {
      fail(res, 'miejscowości', err);
    }
  });

  r.get('/api/weather/location/:id', async (req, res) => {
    try {
      const details = await getImgwLocationDetails(String(req.params['id']));
      if (!details) return void res.status(404).json({ error: 'Nie znaleziono miejscowości/stacji' });
      res.json(details);
    } catch (err) {
      fail(res, 'szczegóły miejscowości', err);
    }
  });

  r.get('/api/weather/synop', async (req, res) => {
    try {
      res.json(await getImgwSynopStations(req.query['force'] === 'true'));
    } catch (err) {
      fail(res, 'stacje synoptyczne', err);
    }
  });

  r.get('/api/weather/synop/:id', async (req, res) => {
    try {
      const station = await getImgwSynopStationById(String(req.params['id']));
      if (!station) return void res.status(404).json({ error: 'Nie znaleziono stacji synoptycznej' });
      res.json(station);
    } catch (err) {
      fail(res, 'stacja synoptyczna', err);
    }
  });

  r.get('/api/weather/history/:id', async (req, res) => {
    try {
      res.json(await getImgwStationHistory(String(req.params['id'])));
    } catch (err) {
      fail(res, 'historia stacji', err);
    }
  });

  r.get('/api/weather/hydro', async (req, res) => {
    try {
      res.json(await getImgwHydroStations(String(req.query['search'] ?? ''), Number(req.query['limit'] ?? 50)));
    } catch (err) {
      fail(res, 'hydrologia', err);
    }
  });

  r.get('/api/weather/meteo', async (req, res) => {
    try {
      res.json(await getImgwMeteoStations(String(req.query['search'] ?? ''), Number(req.query['limit'] ?? 50)));
    } catch (err) {
      fail(res, 'meteo', err);
    }
  });

  r.get('/api/weather/warnings', async (_req, res) => {
    try {
      res.json(await getImgwWarnings());
    } catch (err) {
      fail(res, 'ostrzeżenia', err);
    }
  });

  r.get('/api/weather/favorites', (_req, res) => {
    res.json({ favorites: getImgwFavoriteStations() });
  });

  r.post('/api/weather/favorites', (req, res) => {
    res.json({ favorites: setImgwFavoriteStations(Array.isArray(req.body?.favorites) ? req.body.favorites : []) });
  });

  return r;
}
