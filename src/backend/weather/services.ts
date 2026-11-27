import { ClimateNormals } from './climate';
import { CosmoForecast } from './cosmo';
import { Geocoder } from './geocode';
import { RadarService } from './radar';

/**
 * Usługi pogodowe tworzone dopiero przy pierwszym użyciu — moduł jest też ładowany podczas
 * `ng build` (ekstrakcja tras), a wtedy nie chcemy tworzyć plików ani łączyć się z IMGW.
 */
let cosmo: CosmoForecast | null = null;
let radar: RadarService | null = null;
let climate: ClimateNormals | null = null;
let geocoder: Geocoder | null = null;

export const weatherServices = {
  cosmo: () => (cosmo ??= new CosmoForecast()),
  radar: () => (radar ??= new RadarService()),
  climate: () => (climate ??= new ClimateNormals()),
  geocoder: () => (geocoder ??= new Geocoder()),
};

/** Start w tle: prognoza sprawdza nowe przebiegi co godzinę, normy pobierają się raz. */
export function startWeatherServices(): void {
  weatherServices.cosmo().start();
  void weatherServices.climate().ensure();
}

export function stopWeatherServices(): void {
  cosmo?.stop();
}
