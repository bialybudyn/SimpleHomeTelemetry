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
  type WeatherLocation,
} from '../imgw';
import { locationCoords, stationCoords } from '../weather/coords';
import { weatherServices } from '../weather/services';

async function findLocation(id: string): Promise<WeatherLocation | null> {
  const all = await getImgwLocations();
  return all.find((l) => l.id === id) ?? all.find((l) => l.synopStationId === id) ?? null;
}

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

  // Prognoza COSMO dla miejscowości (punkt: współrzędne powiązanej stacji meteo IMGW)
  r.get('/api/weather/forecast/:id', async (req, res) => {
    try {
      const loc = await findLocation(String(req.params['id']));
      if (!loc) return void res.status(404).json({ error: 'Nie znaleziono miejscowości' });
      const coords = await locationCoords(loc);
      const cosmo = weatherServices.cosmo();
      res.json({
        location: loc.name,
        coords,
        forecast: coords ? cosmo.forecast(coords.lat, coords.lon) : null,
        status: cosmo.status(),
      });
    } catch (err) {
      fail(res, 'prognoza COSMO', err);
    }
  });

  // Radar: lista klatek i opad w okolicy miejscowości
  r.get('/api/weather/radar', async (req, res) => {
    try {
      const radar = weatherServices.radar();
      const frames = await radar.frames();
      const id = typeof req.query['location'] === 'string' ? req.query['location'] : '';
      const loc = id ? await findLocation(id) : null;
      const coords = loc ? await locationCoords(loc) : null;
      const rain = coords ? await radar.rainNear(coords.lat, coords.lon).catch(() => null) : null;
      res.json({ frames, coords, rain });
    } catch (err) {
      fail(res, 'radar', err);
    }
  });

  r.get('/api/weather/radar/image/:stamp', async (req, res) => {
    const stamp = String(req.params['stamp']);
    if (!/^\d{12}$/.test(stamp)) return void res.status(400).json({ error: 'Zły znacznik czasu' });
    try {
      const img = await weatherServices.radar().image(stamp, req.query['kind'] === 'echo' ? 'echo' : 'map');
      if (!img) return void res.status(404).json({ error: 'Brak klatki radaru' });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.end(img);
    } catch (err) {
      fail(res, 'obraz radaru', err);
    }
  });

  // Normy klimatyczne 1991–2020 i rekordy dla stacji synoptycznej miejscowości
  r.get('/api/weather/climate/:id', async (req, res) => {
    try {
      const loc = await findLocation(String(req.params['id']));
      if (!loc) return void res.status(404).json({ error: 'Nie znaleziono miejscowości' });
      const climate = weatherServices.climate();
      const station = (await climate.forStation(loc.synopStationName ?? loc.name)) ?? (await climate.forStation(loc.name));
      res.json({ location: loc.name, station, status: climate.status() });
    } catch (err) {
      fail(res, 'normy klimatyczne', err);
    }
  });

  // Mapa: stacje hydrologiczne i meteorologiczne ze współrzędnymi
  r.get('/api/weather/map', async (req, res) => {
    try {
      const [hydro, meteo] = await Promise.all([getImgwHydroStations('', 5000), getImgwMeteoStations('', 5000)]);
      const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
      const id = typeof req.query['location'] === 'string' ? req.query['location'] : '';
      const loc = id ? await findLocation(id) : null;
      res.json({
        home: loc ? { name: loc.name, coords: await locationCoords(loc) } : null,
        hydro: hydro
          .map((h) => {
            const raw = h as unknown as Record<string, unknown>;
            const lat = num(raw['lat']);
            const lon = num(raw['lon']);
            if (lat == null || lon == null || !lat || !lon) return null;
            return {
              id: h.id_stacji,
              name: h.stacja,
              river: h.rzeka,
              lat,
              lon,
              level: num(h.stan_wody),
              warning: num(h.stan_ostrzegawczy),
              alarm: num(h.stan_alarmowy),
              flow: num(h.przeplyw),
              time: h.stan_wody_data_pomiaru,
            };
          })
          .filter((x) => x !== null),
        meteo: meteo
          .map((m) => {
            const c = stationCoords(m);
            if (!c) return null;
            return { code: m.kod_stacji, name: m.nazwa_stacji, lat: c.lat, lon: c.lon, temp: num(m.temperatura_powietrza), wind: num(m.wiatr_srednia_predkosc), rain10: num(m.opad_10min) };
          })
          .filter((x) => x !== null),
      });
    } catch (err) {
      fail(res, 'mapa stacji', err);
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
