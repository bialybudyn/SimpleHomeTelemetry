import { describe, expect, it } from 'vitest';
import { parseImgwWarning, warningInVoivodeship } from '../imgw';

// Kształt odpowiedzi https://danepubliczne.imgw.pl/api/data/warningsmeteo (listopad 2026)
const METEO = {
  id: 'Sk20261126091824385',
  nazwa_zdarzenia: 'Intensywne opady śniegu',
  stopien: '1',
  prawdopodobienstwo: '80',
  obowiazuje_do: '2026-11-27 15:00:00',
  obowiazuje_od: '2026-11-26 21:00:00',
  opublikowano: '2026-11-26 10:18:00',
  tresc: 'Prognozowane są opady śniegu powodujące przyrost pokrywy śnieżnej o 10 cm do 15 cm.',
  komentarz: 'Brak.',
  biuro: 'Centralne Biuro Prognoz Meteorologicznych w Warszawie',
  teryt: ['2407', '2416', '2465', '1208', '1212', '1214'],
};

// Kształt odpowiedzi warningshydro
const HYDRO = {
  opublikowano: '2026-04-24 09:25:05',
  'stopień': '-1',
  data_od: '2026-04-24 09:30:00',
  data_do: '9999-12-31 23:59:59',
  prawdopodobienstwo: '100',
  numer: '72',
  zdarzenie: 'Susza hydrologiczna',
  przebieg: 'W zlewni Radomki spodziewane jest dalsze utrzymywanie się przepływów wody poniżej SNQ.',
  komentarz: 'Ostrzeżenie wydawane jest w sytuacji…',
  obszary: [{ wojewodztwo: 'mazowieckie', opis: 'mazowieckie, Radomka, susza hydrologiczna', kod_zlewni: ['Z_O_MA_252'] }],
};

describe('Ostrzeżenia IMGW', () => {
  it('ostrzeżenie meteo ma nazwę zjawiska, treść, daty i obszar z kodów TERYT', () => {
    const w = parseImgwWarning(METEO, 'meteo');
    expect(w.zdarzenie).toBe('Intensywne opady śniegu');
    expect(w.przebieg).toContain('przyrost pokrywy śnieżnej');
    expect(w.komentarz).toBeUndefined(); // „Brak.” to nie treść
    expect(w.data_od).toBe('2026-11-26 21:00:00');
    expect(w.data_do).toBe('2026-11-27 15:00:00');
    expect(w.obszary).toEqual([
      { wojewodztwo: 'śląskie', opis: 'śląskie: 3 powiaty' },
      { wojewodztwo: 'małopolskie', opis: 'małopolskie: 3 powiaty' },
    ]);
  });

  it('ostrzeżenie dla Śląska i Małopolski nie trafia do Mazowsza', () => {
    const w = parseImgwWarning(METEO, 'meteo');
    expect(warningInVoivodeship(w, 'Mazowieckie')).toBe(false);
    expect(warningInVoivodeship(w, 'Śląskie')).toBe(true);
    // ostrzeżenie bez obszarów nie jest „wszędzie”
    expect(warningInVoivodeship({ obszary: [] }, 'Mazowieckie')).toBe(false);
    // „pomorskie” to nie „zachodniopomorskie”
    expect(warningInVoivodeship({ obszary: [{ wojewodztwo: 'zachodniopomorskie' }] }, 'Pomorskie')).toBe(false);
  });

  it('ostrzeżenie hydro zachowuje swoje pola i województwo', () => {
    const w = parseImgwWarning(HYDRO, 'hydro');
    expect(w.zdarzenie).toBe('Susza hydrologiczna');
    expect(w.stopien).toBe('-1');
    expect(w.data_do).toBe('do odwołania');
    expect(warningInVoivodeship(w, 'Mazowieckie')).toBe(true);
  });
});
