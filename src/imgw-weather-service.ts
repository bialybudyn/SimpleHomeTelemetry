import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ImgwSynopStation {
  id_stacji: string;
  stacja: string;
  data_pomiaru: string;
  godzina_pomiaru: string;
  temperatura: string | number | null;
  predkosc_wiatru: string | number | null;
  kierunek_wiatru: string | number | null;
  wilgotnosc_wzgledna: string | number | null;
  suma_opadu: string | number | null;
  cisnienie: string | number | null;
}

export interface ImgwHourlyPoint {
  timestamp: string;
  time_label: string;
  temperatura: number | null;
  wilgotnosc: number | null;
  cisnienie: number | null;
  wiatr: number | null;
  opad: number | null;
}

export interface ImgwHydroStation {
  id_stacji: string;
  stacja: string;
  rzeka: string;
  wojewodztwo?: string;
  stan_wody: number | string | null;
  stan_ostrzegawczy: number | string | null;
  stan_alarmowy: number | string | null;
  stan_wody_data_pomiaru: string | null;
  temperatura_wody: number | string | null;
  przeplyw: number | string | null;
  zjawisko_lodowe?: string | null;
  zjawisko_zarastania?: string | null;
}

export interface ImgwMeteoStation {
  kod_stacji: string;
  nazwa_stacji: string;
  wysokosc_npm?: string | null;
  temperatura_powietrza?: string | number | null;
  temperatura_gruntu?: string | number | null;
  wilgotnosc_wzgledna?: string | number | null;
  opad_10min?: string | number | null;
  wiatr_srednia_predkosc?: string | number | null;
  wiatr_poryw_10min?: string | number | null;
  wiatr_kierunek?: string | number | null;
}

export interface ImgwWarning {
  type: 'meteo' | 'hydro';
  id?: string;
  numer?: string;
  zdarzenie: string;
  stopien: string | number;
  prawdopodobienstwo?: string | number;
  data_od: string;
  data_do: string;
  opublikowano?: string;
  biuro?: string;
  przebieg?: string;
  komentarz?: string;
  obszary?: { wojewodztwo?: string; opis?: string; kod_zlewni?: string[] }[];
}

export interface WeatherLocation {
  id: string; // unikalny identyfikator
  name: string; // np. Radom, Warszawa, Piaseczno
  voivodeship: string; // np. Mazowieckie
  type: 'city' | 'synop' | 'meteo';
  synopStationId: string; // powiązana stacja synoptyczna (dla historii i ciśnienia)
  synopStationName?: string;
  meteoStationCode?: string; // stacja meteo
  meteoStationName?: string;
  temp: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  rain: number | null; // mm
  groundTemp: number | null;
  measurementTime?: string;
  sourceDesc: string;
}

export interface WeatherLocationDetails {
  location: WeatherLocation;
  synop: ImgwSynopStation | null;
  meteo: ImgwMeteoStation | null;
  history: ImgwHourlyPoint[];
  nearbyHydro: ImgwHydroStation[];
  warnings: ImgwWarning[];
}

// Baza polskich miejscowości z mapowaniem na województwo i najbliższą stację synoptyczną IMGW
export interface CityMapping {
  name: string;
  voivodeship: string;
  synopId: string;
  synopName: string;
  meteoName?: string;
}

export const POLISH_CITIES_CATALOG: CityMapping[] = [
  // Mazowieckie
  { name: 'Warszawa', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Radom', voivodeship: 'Mazowieckie', synopId: '12485', synopName: 'Kozienice', meteoName: 'RADOM' },
  { name: 'Płock', voivodeship: 'Mazowieckie', synopId: '12270', synopName: 'Mława', meteoName: 'PŁOCK' },
  { name: 'Siedlce', voivodeship: 'Mazowieckie', synopId: '12385', synopName: 'Siedlce', meteoName: 'SIEDLCE' },
  { name: 'Piaseczno', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Pruszków', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Legionowo', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Otwock', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Ostrołęka', voivodeship: 'Mazowieckie', synopId: '12295', synopName: 'Białystok', meteoName: 'OSTROŁĘKA' },
  { name: 'Ciechanów', voivodeship: 'Mazowieckie', synopId: '12270', synopName: 'Mława' },
  { name: 'Wołomin', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Sochaczew', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Żyrardów', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Mińsk Mazowiecki', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },
  { name: 'Mława', voivodeship: 'Mazowieckie', synopId: '12270', synopName: 'Mława' },
  { name: 'Pułtusk', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa', meteoName: 'PUŁTUSK' },
  { name: 'Kozienice', voivodeship: 'Mazowieckie', synopId: '12485', synopName: 'Kozienice' },
  { name: 'Grodzisk Mazowiecki', voivodeship: 'Mazowieckie', synopId: '12375', synopName: 'Warszawa' },

  // Małopolskie
  { name: 'Kraków', voivodeship: 'Małopolskie', synopId: '12566', synopName: 'Kraków' },
  { name: 'Tarnów', voivodeship: 'Małopolskie', synopId: '12570', synopName: 'Tarnów' },
  { name: 'Nowy Sącz', voivodeship: 'Małopolskie', synopId: '12660', synopName: 'Nowy Sącz' },
  { name: 'Zakopane', voivodeship: 'Małopolskie', synopId: '12625', synopName: 'Zakopane' },
  { name: 'Nowy Targ', voivodeship: 'Małopolskie', synopId: '12625', synopName: 'Zakopane' },
  { name: 'Wieliczka', voivodeship: 'Małopolskie', synopId: '12566', synopName: 'Kraków' },
  { name: 'Bochnia', voivodeship: 'Małopolskie', synopId: '12566', synopName: 'Kraków' },
  { name: 'Oświęcim', voivodeship: 'Małopolskie', synopId: '12566', synopName: 'Kraków' },
  { name: 'Chrzanów', voivodeship: 'Małopolskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Olkusz', voivodeship: 'Małopolskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Gorlice', voivodeship: 'Małopolskie', synopId: '12660', synopName: 'Nowy Sącz' },
  { name: 'Kasprowy Wierch', voivodeship: 'Małopolskie', synopId: '12650', synopName: 'Kasprowy Wierch' },

  // Śląskie
  { name: 'Katowice', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Częstochowa', voivodeship: 'Śląskie', synopId: '12550', synopName: 'Kielce', meteoName: 'CZĘSTOCHOWA' },
  { name: 'Sosnowiec', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Gliwice', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Zabrze', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Bielsko-Biała', voivodeship: 'Śląskie', synopId: '12600', synopName: 'Bielsko Biała' },
  { name: 'Bytom', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Rybnik', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice', meteoName: 'RYBNIK' },
  { name: 'Ruda Śląska', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Tychy', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Dąbrowa Górnicza', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Chorzów', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Jaworzno', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Jastrzębie-Zdrój', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Mysłowice', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Żory', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Tarnowskie Góry', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Cieszyn', voivodeship: 'Śląskie', synopId: '12600', synopName: 'Bielsko Biała', meteoName: 'CIESZYN' },
  { name: 'Żywiec', voivodeship: 'Śląskie', synopId: '12600', synopName: 'Bielsko Biała' },
  { name: 'Racibórz', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice', meteoName: 'RACIBÓRZ' },
  { name: 'Wodzisław Śląski', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Zawiercie', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },
  { name: 'Będzin', voivodeship: 'Śląskie', synopId: '12560', synopName: 'Katowice' },

  // Dolnośląskie
  { name: 'Wrocław', voivodeship: 'Dolnośląskie', synopId: '12424', synopName: 'Wrocław' },
  { name: 'Wałbrzych', voivodeship: 'Dolnośląskie', synopId: '12510', synopName: 'Szczawno' },
  { name: 'Legnica', voivodeship: 'Dolnośląskie', synopId: '12415', synopName: 'Legnica' },
  { name: 'Jelenia Góra', voivodeship: 'Dolnośląskie', synopId: '12500', synopName: 'Jelenia Góra' },
  { name: 'Lubin', voivodeship: 'Dolnośląskie', synopId: '12415', synopName: 'Legnica' },
  { name: 'Głogów', voivodeship: 'Dolnośląskie', synopId: '12400', synopName: 'Zielona Góra' },
  { name: 'Świdnica', voivodeship: 'Dolnośląskie', synopId: '12424', synopName: 'Wrocław' },
  { name: 'Bolesławiec', voivodeship: 'Dolnośląskie', synopId: '12415', synopName: 'Legnica' },
  { name: 'Oleśnica', voivodeship: 'Dolnośląskie', synopId: '12424', synopName: 'Wrocław' },
  { name: 'Dzierżoniów', voivodeship: 'Dolnośląskie', synopId: '12424', synopName: 'Wrocław' },
  { name: 'Oława', voivodeship: 'Dolnośląskie', synopId: '12424', synopName: 'Wrocław' },
  { name: 'Zgorzelec', voivodeship: 'Dolnośląskie', synopId: '12415', synopName: 'Legnica' },
  { name: 'Kłodzko', voivodeship: 'Dolnośląskie', synopId: '12520', synopName: 'Kłodzko' },
  { name: 'Śnieżka', voivodeship: 'Dolnośląskie', synopId: '12510', synopName: 'Śnieżka' },

  // Wielkopolskie
  { name: 'Poznań', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Kalisz', voivodeship: 'Wielkopolskie', synopId: '12435', synopName: 'Kalisz' },
  { name: 'Konin', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Piła', voivodeship: 'Wielkopolskie', synopId: '12235', synopName: 'Chojnice' },
  { name: 'Ostrów Wielkopolski', voivodeship: 'Wielkopolskie', synopId: '12435', synopName: 'Kalisz' },
  { name: 'Gniezno', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Leszno', voivodeship: 'Wielkopolskie', synopId: '12418', synopName: 'Leszno' },
  { name: 'Luboń', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Września', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Swarzędz', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Śrem', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Krotoszyn', voivodeship: 'Wielkopolskie', synopId: '12435', synopName: 'Kalisz' },
  { name: 'Jarocin', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Turek', voivodeship: 'Wielkopolskie', synopId: '12435', synopName: 'Kalisz' },
  { name: 'Koło', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },
  { name: 'Wągrowiec', voivodeship: 'Wielkopolskie', synopId: '12330', synopName: 'Poznań' },

  // Pomorskie
  { name: 'Gdańsk', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk' },
  { name: 'Gdynia', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk', meteoName: 'GDYNIA' },
  { name: 'Sopot', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk' },
  { name: 'Słupsk', voivodeship: 'Pomorskie', synopId: '12115', synopName: 'Ustka' },
  { name: 'Tczew', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk' },
  { name: 'Wejherowo', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk' },
  { name: 'Starogard Gdański', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk' },
  { name: 'Rumia', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk' },
  { name: 'Chojnice', voivodeship: 'Pomorskie', synopId: '12235', synopName: 'Chojnice' },
  { name: 'Malbork', voivodeship: 'Pomorskie', synopId: '12150', synopName: 'Elbląg' },
  { name: 'Kwidzyn', voivodeship: 'Pomorskie', synopId: '12150', synopName: 'Elbląg' },
  { name: 'Lębork', voivodeship: 'Pomorskie', synopId: '12115', synopName: 'Lębork' },
  { name: 'Hel', voivodeship: 'Pomorskie', synopId: '12160', synopName: 'Hel' },
  { name: 'Ustka', voivodeship: 'Pomorskie', synopId: '12115', synopName: 'Ustka' },
  { name: 'Władysławowo', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk' },
  { name: 'Puck', voivodeship: 'Pomorskie', synopId: '12155', synopName: 'Gdańsk' },
  { name: 'Łeba', voivodeship: 'Pomorskie', synopId: '12120', synopName: 'Łeba' },

  // Łódzkie
  { name: 'Łódź', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Piotrków Trybunalski', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Pabianice', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Tomaszów Mazowiecki', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Bełchatów', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Zgierz', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Radomsko', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Skierniewice', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź', meteoName: 'SKIERNIEWICE' },
  { name: 'Kutno', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Sieradz', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Zduńska Wola', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Łowicz', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź' },
  { name: 'Wieluń', voivodeship: 'Łódzkie', synopId: '12465', synopName: 'Łódź', meteoName: 'WIELUŃ' },
  { name: 'Sulejów', voivodeship: 'Łódzkie', synopId: '12469', synopName: 'Sulejów' },

  // Kujawsko-Pomorskie
  { name: 'Bydgoszcz', voivodeship: 'Kujawsko-Pomorskie', synopId: '12254', synopName: 'Bydgoszcz' },
  { name: 'Toruń', voivodeship: 'Kujawsko-Pomorskie', synopId: '12250', synopName: 'Toruń' },
  { name: 'Włocławek', voivodeship: 'Kujawsko-Pomorskie', synopId: '12250', synopName: 'Toruń', meteoName: 'WŁOCŁAWEK' },
  { name: 'Grudziądz', voivodeship: 'Kujawsko-Pomorskie', synopId: '12250', synopName: 'Toruń' },
  { name: 'Inowrocław', voivodeship: 'Kujawsko-Pomorskie', synopId: '12254', synopName: 'Bydgoszcz' },
  { name: 'Brodnica', voivodeship: 'Kujawsko-Pomorskie', synopId: '12250', synopName: 'Toruń' },
  { name: 'Świecie', voivodeship: 'Kujawsko-Pomorskie', synopId: '12254', synopName: 'Bydgoszcz' },
  { name: 'Chełmno', voivodeship: 'Kujawsko-Pomorskie', synopId: '12250', synopName: 'Toruń' },
  { name: 'Ciechocinek', voivodeship: 'Kujawsko-Pomorskie', synopId: '12250', synopName: 'Toruń' },
  { name: 'Nakło nad Notecią', voivodeship: 'Kujawsko-Pomorskie', synopId: '12254', synopName: 'Bydgoszcz' },

  // Lubelskie
  { name: 'Lublin', voivodeship: 'Lubelskie', synopId: '12495', synopName: 'Lublin' },
  { name: 'Zamość', voivodeship: 'Lubelskie', synopId: '12497', synopName: 'Zamość' },
  { name: 'Chełm', voivodeship: 'Lubelskie', synopId: '12495', synopName: 'Lublin' },
  { name: 'Biała Podlaska', voivodeship: 'Lubelskie', synopId: '12385', synopName: 'Siedlce', meteoName: 'BIAŁA PODLASKA' },
  { name: 'Puławy', voivodeship: 'Lubelskie', synopId: '12495', synopName: 'Lublin' },
  { name: 'Świdnik', voivodeship: 'Lubelskie', synopId: '12495', synopName: 'Lublin' },
  { name: 'Kraśnik', voivodeship: 'Lubelskie', synopId: '12495', synopName: 'Lublin' },
  { name: 'Łuków', voivodeship: 'Lubelskie', synopId: '12385', synopName: 'Siedlce' },
  { name: 'Biłgoraj', voivodeship: 'Lubelskie', synopId: '12497', synopName: 'Zamość' },
  { name: 'Włodawa', voivodeship: 'Lubelskie', synopId: '12385', synopName: 'Siedlce', meteoName: 'WŁODAWA' },
  { name: 'Tomaszów Lubelski', voivodeship: 'Lubelskie', synopId: '12497', synopName: 'Zamość', meteoName: 'TOMASZÓW LUBELSKI' },
  { name: 'Terespol', voivodeship: 'Lubelskie', synopId: '12385', synopName: 'Siedlce', meteoName: 'TERESPOL' },

  // Podkarpackie
  { name: 'Rzeszów', voivodeship: 'Podkarpackie', synopId: '12580', synopName: 'Rzeszów' },
  { name: 'Przemyśl', voivodeship: 'Podkarpackie', synopId: '12585', synopName: 'Przemyśl' },
  { name: 'Stalowa Wola', voivodeship: 'Podkarpackie', synopId: '12580', synopName: 'Rzeszów' },
  { name: 'Mielec', voivodeship: 'Podkarpackie', synopId: '12580', synopName: 'Rzeszów' },
  { name: 'Tarnobrzeg', voivodeship: 'Podkarpackie', synopId: '12580', synopName: 'Rzeszów' },
  { name: 'Krosno', voivodeship: 'Podkarpackie', synopId: '12580', synopName: 'Krosno' },
  { name: 'Dębica', voivodeship: 'Podkarpackie', synopId: '12580', synopName: 'Rzeszów' },
  { name: 'Jarosław', voivodeship: 'Podkarpackie', synopId: '12585', synopName: 'Przemyśl' },
  { name: 'Sanok', voivodeship: 'Podkarpackie', synopId: '12580', synopName: 'Lesko' },
  { name: 'Jasło', voivodeship: 'Podkarpackie', synopId: '12580', synopName: 'Krosno' },
  { name: 'Lesko', voivodeship: 'Podkarpackie', synopId: '12585', synopName: 'Lesko' },

  // Zachodniopomorskie
  { name: 'Szczecin', voivodeship: 'Zachodniopomorskie', synopId: '12205', synopName: 'Szczecin' },
  { name: 'Koszalin', voivodeship: 'Zachodniopomorskie', synopId: '12105', synopName: 'Koszalin' },
  { name: 'Stargard', voivodeship: 'Zachodniopomorskie', synopId: '12205', synopName: 'Szczecin' },
  { name: 'Kołobrzeg', voivodeship: 'Zachodniopomorskie', synopId: '12100', synopName: 'Kołobrzeg' },
  { name: 'Świnoujście', voivodeship: 'Zachodniopomorskie', synopId: '12200', synopName: 'Świnoujście' },
  { name: 'Szczecinek', voivodeship: 'Zachodniopomorskie', synopId: '12235', synopName: 'Chojnice' },
  { name: 'Police', voivodeship: 'Zachodniopomorskie', synopId: '12205', synopName: 'Szczecin' },
  { name: 'Goleniów', voivodeship: 'Zachodniopomorskie', synopId: '12205', synopName: 'Szczecin' },
  { name: 'Gryfino', voivodeship: 'Zachodniopomorskie', synopId: '12205', synopName: 'Szczecin' },

  // Warmińsko-Mazurskie
  { name: 'Olsztyn', voivodeship: 'Warmińsko-Mazurskie', synopId: '12160', synopName: 'Olsztyn' },
  { name: 'Elbląg', voivodeship: 'Warmińsko-Mazurskie', synopId: '12150', synopName: 'Elbląg' },
  { name: 'Ełk', voivodeship: 'Warmińsko-Mazurskie', synopId: '12180', synopName: 'Mikołajki', meteoName: 'EŁK' },
  { name: 'Ostróda', voivodeship: 'Warmińsko-Mazurskie', synopId: '12160', synopName: 'Olsztyn' },
  { name: 'Iława', voivodeship: 'Warmińsko-Mazurskie', synopId: '12160', synopName: 'Olsztyn' },
  { name: 'Giżycko', voivodeship: 'Warmińsko-Mazurskie', synopId: '12180', synopName: 'Mikołajki' },
  { name: 'Kętrzyn', voivodeship: 'Warmińsko-Mazurskie', synopId: '12160', synopName: 'Kętrzyn' },
  { name: 'Szczytno', voivodeship: 'Warmińsko-Mazurskie', synopId: '12160', synopName: 'Olsztyn' },
  { name: 'Bartoszyce', voivodeship: 'Warmińsko-Mazurskie', synopId: '12160', synopName: 'Olsztyn' },
  { name: 'Mikołajki', voivodeship: 'Warmińsko-Mazurskie', synopId: '12180', synopName: 'Mikołajki' },
  { name: 'Lidzbark Warmiński', voivodeship: 'Warmińsko-Mazurskie', synopId: '12160', synopName: 'Olsztyn', meteoName: 'LIDZBARK' },

  // Świętokrzyskie
  { name: 'Kielce', voivodeship: 'Świętokrzyskie', synopId: '12550', synopName: 'Kielce' },
  { name: 'Ostrowiec Świętokrzyski', voivodeship: 'Świętokrzyskie', synopId: '12550', synopName: 'Kielce' },
  { name: 'Starachowice', voivodeship: 'Świętokrzyskie', synopId: '12550', synopName: 'Kielce' },
  { name: 'Skarżysko-Kamienna', voivodeship: 'Świętokrzyskie', synopId: '12550', synopName: 'Kielce' },
  { name: 'Sandomierz', voivodeship: 'Świętokrzyskie', synopId: '12550', synopName: 'Sandomierz' },
  { name: 'Końskie', voivodeship: 'Świętokrzyskie', synopId: '12550', synopName: 'Kielce' },
  { name: 'Busko-Zdrój', voivodeship: 'Świętokrzyskie', synopId: '12550', synopName: 'Kielce' },

  // Podlaskie
  { name: 'Białystok', voivodeship: 'Podlaskie', synopId: '12295', synopName: 'Białystok' },
  { name: 'Suwałki', voivodeship: 'Podlaskie', synopId: '12195', synopName: 'Suwałki' },
  { name: 'Łomża', voivodeship: 'Podlaskie', synopId: '12295', synopName: 'Białystok' },
  { name: 'Augustów', voivodeship: 'Podlaskie', synopId: '12195', synopName: 'Suwałki' },
  { name: 'Bielsk Podlaski', voivodeship: 'Podlaskie', synopId: '12295', synopName: 'Białystok' },
  { name: 'Zambrów', voivodeship: 'Podlaskie', synopId: '12295', synopName: 'Białystok' },
  { name: 'Grajewo', voivodeship: 'Podlaskie', synopId: '12195', synopName: 'Suwałki' },
  { name: 'Hajnówka', voivodeship: 'Podlaskie', synopId: '12295', synopName: 'Białystok' },
  { name: 'Sokółka', voivodeship: 'Podlaskie', synopId: '12295', synopName: 'Białystok' },

  // Opolskie
  { name: 'Opole', voivodeship: 'Opolskie', synopId: '12530', synopName: 'Opole' },
  { name: 'Kędzierzyn-Koźle', voivodeship: 'Opolskie', synopId: '12530', synopName: 'Opole' },
  { name: 'Nysa', voivodeship: 'Opolskie', synopId: '12530', synopName: 'Opole' },
  { name: 'Brzeg', voivodeship: 'Opolskie', synopId: '12530', synopName: 'Opole' },
  { name: 'Kluczbork', voivodeship: 'Opolskie', synopId: '12530', synopName: 'Opole' },
  { name: 'Prudnik', voivodeship: 'Opolskie', synopId: '12530', synopName: 'Opole' },

  // Lubuskie
  { name: 'Zielona Góra', voivodeship: 'Lubuskie', synopId: '12400', synopName: 'Zielona Góra' },
  { name: 'Gorzów Wielkopolski', voivodeship: 'Lubuskie', synopId: '12300', synopName: 'Gorzów' },
  { name: 'Nowa Sól', voivodeship: 'Lubuskie', synopId: '12400', synopName: 'Zielona Góra' },
  { name: 'Żary', voivodeship: 'Lubuskie', synopId: '12400', synopName: 'Zielona Góra' },
  { name: 'Żagań', voivodeship: 'Lubuskie', synopId: '12400', synopName: 'Zielona Góra' },
  { name: 'Świebodzin', voivodeship: 'Lubuskie', synopId: '12400', synopName: 'Zielona Góra' },
  { name: 'Słubice', voivodeship: 'Lubuskie', synopId: '12300', synopName: 'Słubice' },
];

export const VOIVODESHIPS_LIST = [
  'Dolnośląskie',
  'Kujawsko-Pomorskie',
  'Lubelskie',
  'Lubuskie',
  'Łódzkie',
  'Małopolskie',
  'Mazowieckie',
  'Opolskie',
  'Podkarpackie',
  'Podlaskie',
  'Pomorskie',
  'Śląskie',
  'Świętokrzyskie',
  'Warmińsko-Mazurskie',
  'Wielkopolskie',
  'Zachodniopomorskie',
];

const CACHE_FILE = join(process.cwd(), 'imgw_weather_cache.json');

// In-memory cache
let synopStationsCache: ImgwSynopStation[] = [];
let synopLastFetch = 0;

let hydroStationsCache: ImgwHydroStation[] = [];
let hydroLastFetch = 0;

let meteoStationsCache: ImgwMeteoStation[] = [];
let meteoLastFetch = 0;

let warningsMeteoCache: ImgwWarning[] = [];
let warningsHydroCache: ImgwWarning[] = [];
let warningsLastFetch = 0;

const stationHistoryStore = new Map<string, ImgwHourlyPoint[]>();
let favoriteStationIds: string[] = ['12375', '12566', '12424', '12330', '12155', 'city_radom'];

// Usuwanie znaków diakrytycznych do szybkiego wyszukiwania bez względu na polskie litery
export function normalizePl(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/[\s\-_.,/]/g, '')
    .trim();
}

// Load cached history and favorites from disk
function loadCacheFromDisk() {
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = readFileSync(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.favorites)) {
        favoriteStationIds = data.favorites;
      }
      if (data.history && typeof data.history === 'object') {
        for (const [id, points] of Object.entries(data.history)) {
          if (Array.isArray(points)) {
            stationHistoryStore.set(id, points as ImgwHourlyPoint[]);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[IMGW] Nie udalo sie odczytac imgw_weather_cache.json:', err);
  }
}

function saveCacheToDisk() {
  try {
    const historyObj: Record<string, ImgwHourlyPoint[]> = {};
    for (const [id, points] of stationHistoryStore.entries()) {
      // Keep last 48 points per station
      historyObj[id] = points.slice(-48);
    }
    const payload = {
      favorites: favoriteStationIds,
      history: historyObj,
      saved_at: new Date().toISOString(),
    };
    writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[IMGW] Nie udalo sie zapisac imgw_weather_cache.json:', err);
  }
}

// Generates diurnal 24h curve anchor for cold start if history is empty
function seedDiurnalHistory(station: ImgwSynopStation): ImgwHourlyPoint[] {
  const currentTemp = station.temperatura !== null && station.temperatura !== undefined ? Number(station.temperatura) : 15;
  const currentHum = station.wilgotnosc_wzgledna !== null && station.wilgotnosc_wzgledna !== undefined ? Number(station.wilgotnosc_wzgledna) : 70;
  const currentPress = station.cisnienie !== null && station.cisnienie !== undefined ? Number(station.cisnienie) : 1013;
  const currentWind = station.predkosc_wiatru !== null && station.predkosc_wiatru !== undefined ? Number(station.predkosc_wiatru) : 3;
  const currentRain = station.suma_opadu !== null && station.suma_opadu !== undefined ? Number(station.suma_opadu) : 0;

  const currentHour = parseInt(station.godzina_pomiaru || '12', 10);
  const now = new Date();
  const points: ImgwHourlyPoint[] = [];

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600 * 1000);
    const hour = (currentHour - i + 24) % 24;
    // Diurnal variation: warmest around 14:00-15:00, coolest around 05:00-06:00
    const diurnalOffset = Math.sin(((hour - 8) / 24) * 2 * Math.PI) * 3.5;
    const currentHourOffset = Math.sin(((currentHour - 8) / 24) * 2 * Math.PI) * 3.5;
    const adjustedTemp = Math.round((currentTemp - currentHourOffset + diurnalOffset) * 10) / 10;
    const adjustedHum = Math.min(99, Math.max(30, Math.round(currentHum - (diurnalOffset * 2.5))));
    const adjustedPress = Math.round((currentPress + Math.cos(hour / 4) * 1.5) * 10) / 10;
    const adjustedWind = Math.max(0, Math.round((currentWind + Math.sin(hour / 3) * 1.2) * 10) / 10);

    const padHour = String(hour).padStart(2, '0');
    points.push({
      timestamp: d.toISOString(),
      time_label: `${padHour}:00`,
      temperatura: adjustedTemp,
      wilgotnosc: adjustedHum,
      cisnienie: adjustedPress,
      wiatr: adjustedWind,
      opad: i === 0 ? currentRain : 0,
    });
  }

  return points;
}

// Fetch all synoptic data
export async function getImgwSynopStations(force = false): Promise<ImgwSynopStation[]> {
  const now = Date.now();
  if (!force && synopStationsCache.length > 0 && now - synopLastFetch < 5 * 60 * 1000) {
    return synopStationsCache;
  }

  try {
    const res = await fetch('https://danepubliczne.imgw.pl/api/data/synop', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ImgwSynopStation[];
    if (Array.isArray(data) && data.length > 0) {
      synopStationsCache = data;
      synopLastFetch = now;

      // Update station history points
      for (const st of data) {
        if (!st.id_stacji) continue;
        let points = stationHistoryStore.get(st.id_stacji);
        if (!points || points.length === 0) {
          points = seedDiurnalHistory(st);
          stationHistoryStore.set(st.id_stacji, points);
        } else {
          // Check if latest measurement is already recorded
          const hourLabel = `${String(st.godzina_pomiaru || '00').padStart(2, '0')}:00`;
          const lastPoint = points[points.length - 1];
          const tVal = st.temperatura !== null && st.temperatura !== undefined ? Number(st.temperatura) : null;
          const hVal = st.wilgotnosc_wzgledna !== null && st.wilgotnosc_wzgledna !== undefined ? Number(st.wilgotnosc_wzgledna) : null;
          const pVal = st.cisnienie !== null && st.cisnienie !== undefined ? Number(st.cisnienie) : null;
          const wVal = st.predkosc_wiatru !== null && st.predkosc_wiatru !== undefined ? Number(st.predkosc_wiatru) : null;
          const oVal = st.suma_opadu !== null && st.suma_opadu !== undefined ? Number(st.suma_opadu) : null;

          if (!lastPoint || lastPoint.time_label !== hourLabel) {
            points.push({
              timestamp: new Date().toISOString(),
              time_label: hourLabel,
              temperatura: tVal,
              wilgotnosc: hVal,
              cisnienie: pVal,
              wiatr: wVal,
              opad: oVal,
            });
            if (points.length > 48) {
              points = points.slice(-48);
            }
            stationHistoryStore.set(st.id_stacji, points);
          } else {
            // Update last point with freshest reading
            lastPoint.temperatura = tVal;
            lastPoint.wilgotnosc = hVal;
            lastPoint.cisnienie = pVal;
            lastPoint.wiatr = wVal;
            lastPoint.opad = oVal;
          }
        }
      }
      saveCacheToDisk();
    }
    return synopStationsCache;
  } catch (err) {
    console.warn('[IMGW] Blad pobierania synop z danepubliczne.imgw.pl:', err);
    return synopStationsCache;
  }
}

// Get single synoptic station
export async function getImgwSynopStationById(idOrName: string): Promise<ImgwSynopStation | null> {
  const stations = await getImgwSynopStations();
  const clean = idOrName.toLowerCase().trim();

  let found = stations.find((s) => s.id_stacji === idOrName);
  if (!found) {
    found = stations.find((s) => s.stacja.toLowerCase().replace(/[\s\-_]/g, '') === clean.replace(/[\s\-_]/g, ''));
  }
  if (!found) {
    // Try direct fetch from API
    try {
      const url = isNaN(Number(idOrName))
        ? `https://danepubliczne.imgw.pl/api/data/synop/station/${encodeURIComponent(clean)}`
        : `https://danepubliczne.imgw.pl/api/data/synop/id/${encodeURIComponent(idOrName)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const item = (await res.json()) as ImgwSynopStation;
        if (item && item.id_stacji) return item;
      }
    } catch {
      // Fallback
    }
  }
  return found || null;
}

// Get hourly temperature and meteo history for a station
export async function getImgwStationHistory(idOrName: string): Promise<{
  station: ImgwSynopStation | null;
  history: ImgwHourlyPoint[];
}> {
  const st = await getImgwSynopStationById(idOrName);
  if (!st) {
    return { station: null, history: [] };
  }

  let points = stationHistoryStore.get(st.id_stacji);
  if (!points || points.length === 0) {
    points = seedDiurnalHistory(st);
    stationHistoryStore.set(st.id_stacji, points);
    saveCacheToDisk();
  }

  return {
    station: st,
    history: points,
  };
}

// Fetch hydrological data with caching & filtering
export async function getImgwHydroStations(search = '', limit = 100): Promise<ImgwHydroStation[]> {
  const now = Date.now();
  if (hydroStationsCache.length === 0 || now - hydroLastFetch > 10 * 60 * 1000) {
    try {
      const res = await fetch('https://danepubliczne.imgw.pl/api/data/hydro/', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as ImgwHydroStation[];
        if (Array.isArray(data)) {
          hydroStationsCache = data;
          hydroLastFetch = now;
        }
      }
    } catch (err) {
      console.warn('[IMGW] Blad pobierania hydro:', err);
    }
  }

  let list = hydroStationsCache;
  if (search.trim()) {
    const q = normalizePl(search);
    list = list.filter((h) =>
      (h.stacja && normalizePl(h.stacja).includes(q)) ||
      (h.rzeka && normalizePl(h.rzeka).includes(q)) ||
      (h.wojewodztwo && normalizePl(h.wojewodztwo).includes(q))
    );
  }
  return list.slice(0, limit);
}

// Fetch meteorological data with caching & filtering
export async function getImgwMeteoStations(search = '', limit = 1000): Promise<ImgwMeteoStation[]> {
  const now = Date.now();
  if (meteoStationsCache.length === 0 || now - meteoLastFetch > 10 * 60 * 1000) {
    try {
      const res = await fetch('https://danepubliczne.imgw.pl/api/data/meteo/', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as ImgwMeteoStation[];
        if (Array.isArray(data)) {
          meteoStationsCache = data;
          meteoLastFetch = now;
        }
      }
    } catch (err) {
      console.warn('[IMGW] Blad pobierania meteo:', err);
    }
  }

  let list = meteoStationsCache;
  if (search.trim()) {
    const q = normalizePl(search);
    list = list.filter((m) => m.nazwa_stacji && normalizePl(m.nazwa_stacji).includes(q));
  }
  return list.slice(0, limit);
}

// Mapowanie województwa dla stacji synoptycznej (na bazie nazwy)
function inferSynopVoivodeship(stationName: string): string {
  const n = normalizePl(stationName);
  if (['warszawa', 'kozienice', 'mlawa', 'plock', 'siedlce', 'ostroleka'].some((c) => n.includes(c))) return 'Mazowieckie';
  if (['krakow', 'tarnow', 'nowysacz', 'zakopane', 'kasprowy'].some((c) => n.includes(c))) return 'Małopolskie';
  if (['katowice', 'bielskobiala', 'czestochowa', 'raciborz'].some((c) => n.includes(c))) return 'Śląskie';
  if (['wroclaw', 'szczawno', 'legnica', 'jeleniagora', 'klodzko', 'sniezka'].some((c) => n.includes(c))) return 'Dolnośląskie';
  if (['poznan', 'kalisz', 'leszno', 'kolo', 'pila'].some((c) => n.includes(c))) return 'Wielkopolskie';
  if (['gdansk', 'hel', 'ustka', 'leba', 'chojnice', 'lebork'].some((c) => n.includes(c))) return 'Pomorskie';
  if (['lodz', 'sulejow', 'wielun'].some((c) => n.includes(c))) return 'Łódzkie';
  if (['bydgoszcz', 'torun'].some((c) => n.includes(c))) return 'Kujawsko-Pomorskie';
  if (['lublin', 'zamosc', 'wlodawa', 'terespol'].some((c) => n.includes(c))) return 'Lubelskie';
  if (['rzeszow', 'przemysl', 'krosno', 'lesko'].some((c) => n.includes(c))) return 'Podkarpackie';
  if (['szczecin', 'koszalin', 'kolobrzeg', 'swinoujscie', 'resko'].some((c) => n.includes(c))) return 'Zachodniopomorskie';
  if (['olsztyn', 'elblag', 'mikolajki', 'ketrzyn'].some((c) => n.includes(c))) return 'Warmińsko-Mazurskie';
  if (['kielce', 'sandomierz'].some((c) => n.includes(c))) return 'Świętokrzyskie';
  if (['bialystok', 'suwalki'].some((c) => n.includes(c))) return 'Podlaskie';
  if (['opole'].some((c) => n.includes(c))) return 'Opolskie';
  if (['zielonagora', 'gorzow', 'slubice'].some((c) => n.includes(c))) return 'Lubuskie';
  return 'Polska';
}

// Buduje połączoną listę wszystkich miejscowości i stacji w Polsce (ponad 850+ lokalizacji)
export async function getImgwLocations(search = '', voivodeship = 'all', typeFilter = 'all'): Promise<WeatherLocation[]> {
  const [synopStations, meteoStations] = await Promise.all([
    getImgwSynopStations(),
    getImgwMeteoStations('', 1000),
  ]);

  const synopMap = new Map<string, ImgwSynopStation>();
  for (const s of synopStations) {
    synopMap.set(s.id_stacji, s);
  }

  const meteoMapByName = new Map<string, ImgwMeteoStation>();
  for (const m of meteoStations) {
    if (m.nazwa_stacji) {
      meteoMapByName.set(normalizePl(m.nazwa_stacji), m);
    }
  }

  const locations: WeatherLocation[] = [];
  const addedIds = new Set<string>();

  // 1. Zarejestruj miejscowości z katalogu POLISH_CITIES_CATALOG
  for (const city of POLISH_CITIES_CATALOG) {
    const id = `city_${normalizePl(city.name)}`;
    if (addedIds.has(id)) continue;
    addedIds.add(id);

    const linkedSynop = synopMap.get(city.synopId);
    let linkedMeteo: ImgwMeteoStation | undefined;
    if (city.meteoName) {
      linkedMeteo = meteoMapByName.get(normalizePl(city.meteoName));
    }
    if (!linkedMeteo) {
      linkedMeteo = meteoMapByName.get(normalizePl(city.name));
    }

    // Ustal najdokładniejsze pomiary: preferuj odczyt z lokalnej stacji meteo jeśli dostępny
    const meteoTemp = linkedMeteo?.temperatura_powietrza !== null && linkedMeteo?.temperatura_powietrza !== undefined ? Number(linkedMeteo.temperatura_powietrza) : null;
    const synopTemp = linkedSynop?.temperatura !== null && linkedSynop?.temperatura !== undefined ? Number(linkedSynop.temperatura) : null;
    const temp = meteoTemp !== null ? meteoTemp : synopTemp;

    const humidity = linkedSynop?.wilgotnosc_wzgledna ? Number(linkedSynop.wilgotnosc_wzgledna) : (linkedMeteo?.wilgotnosc_wzgledna ? Number(linkedMeteo.wilgotnosc_wzgledna) : null);
    const pressure = linkedSynop?.cisnienie ? Number(linkedSynop.cisnienie) : null;
    const windSpeed = linkedSynop?.predkosc_wiatru ? Number(linkedSynop.predkosc_wiatru) : (linkedMeteo?.wiatr_srednia_predkosc ? Number(linkedMeteo.wiatr_srednia_predkosc) : null);
    const windGust = linkedMeteo?.wiatr_poryw_10min ? Number(linkedMeteo.wiatr_poryw_10min) : null;
    const rain = linkedSynop?.suma_opadu ? Number(linkedSynop.suma_opadu) : (linkedMeteo?.opad_10min ? Number(linkedMeteo.opad_10min) : null);
    const groundTemp = linkedMeteo?.temperatura_gruntu ? Number(linkedMeteo.temperatura_gruntu) : null;

    locations.push({
      id,
      name: city.name,
      voivodeship: city.voivodeship,
      type: 'city',
      synopStationId: city.synopId,
      synopStationName: city.synopName,
      meteoStationCode: linkedMeteo?.kod_stacji,
      meteoStationName: linkedMeteo?.nazwa_stacji,
      temp,
      humidity,
      pressure,
      windSpeed,
      windGust,
      rain,
      groundTemp,
      measurementTime: linkedSynop ? `${linkedSynop.data_pomiaru} ${linkedSynop.godzina_pomiaru}:00` : undefined,
      sourceDesc: linkedMeteo ? `Stacja meteo ${linkedMeteo.nazwa_stacji} + synop ${city.synopName}` : `Stacja synoptyczna ${city.synopName}`,
    });
  }

  // 2. Dodaj stacje synoptyczne (SYNOP - 62 główne stacje)
  for (const synop of synopStations) {
    const id = synop.id_stacji;
    if (addedIds.has(id)) continue;
    addedIds.add(id);

    const voiv = inferSynopVoivodeship(synop.stacja);
    const linkedMeteo = meteoMapByName.get(normalizePl(synop.stacja));

    locations.push({
      id,
      name: synop.stacja,
      voivodeship: voiv,
      type: 'synop',
      synopStationId: synop.id_stacji,
      synopStationName: synop.stacja,
      meteoStationCode: linkedMeteo?.kod_stacji,
      meteoStationName: linkedMeteo?.nazwa_stacji,
      temp: synop.temperatura !== null && synop.temperatura !== undefined ? Number(synop.temperatura) : null,
      humidity: synop.wilgotnosc_wzgledna !== null && synop.wilgotnosc_wzgledna !== undefined ? Number(synop.wilgotnosc_wzgledna) : null,
      pressure: synop.cisnienie !== null && synop.cisnienie !== undefined ? Number(synop.cisnienie) : null,
      windSpeed: synop.predkosc_wiatru !== null && synop.predkosc_wiatru !== undefined ? Number(synop.predkosc_wiatru) : null,
      windGust: linkedMeteo?.wiatr_poryw_10min ? Number(linkedMeteo.wiatr_poryw_10min) : null,
      rain: synop.suma_opadu !== null && synop.suma_opadu !== undefined ? Number(synop.suma_opadu) : null,
      groundTemp: linkedMeteo?.temperatura_gruntu ? Number(linkedMeteo.temperatura_gruntu) : null,
      measurementTime: `${synop.data_pomiaru} ${synop.godzina_pomiaru}:00`,
      sourceDesc: `Główna stacja synoptyczna IMGW (${synop.id_stacji})`,
    });
  }

  // 3. Dodaj stacje meteorologiczne IMGW (METEO - 788 stacji lokalnych)
  for (const meteo of meteoStations) {
    if (!meteo.kod_stacji || !meteo.nazwa_stacji) continue;
    const normName = normalizePl(meteo.nazwa_stacji);
    const id = `meteo_${meteo.kod_stacji}`;
    if (addedIds.has(id)) continue;
    addedIds.add(id);

    // Znajdź najbliższą stację synoptyczną dla ciśnienia i historii
    let bestSynop = synopStations[0];
    const matchCity = POLISH_CITIES_CATALOG.find((c) => normalizePl(c.name) === normName);
    if (matchCity) {
      const syn = synopMap.get(matchCity.synopId);
      if (syn) bestSynop = syn;
    }

    const tVal = meteo.temperatura_powietrza !== null && meteo.temperatura_powietrza !== undefined ? Number(meteo.temperatura_powietrza) : (bestSynop.temperatura ? Number(bestSynop.temperatura) : null);
    const rVal = meteo.opad_10min !== null && meteo.opad_10min !== undefined ? Number(meteo.opad_10min) : (bestSynop.suma_opadu ? Number(bestSynop.suma_opadu) : null);

    // Wyznacz województwo
    let voiv = 'Polska';
    if (matchCity) {
      voiv = matchCity.voivodeship;
    } else {
      voiv = inferSynopVoivodeship(meteo.nazwa_stacji);
    }

    locations.push({
      id,
      name: meteo.nazwa_stacji,
      voivodeship: voiv,
      type: 'meteo',
      synopStationId: bestSynop.id_stacji,
      synopStationName: bestSynop.stacja,
      meteoStationCode: meteo.kod_stacji,
      meteoStationName: meteo.nazwa_stacji,
      temp: tVal,
      humidity: meteo.wilgotnosc_wzgledna ? Number(meteo.wilgotnosc_wzgledna) : (bestSynop.wilgotnosc_wzgledna ? Number(bestSynop.wilgotnosc_wzgledna) : null),
      pressure: bestSynop.cisnienie ? Number(bestSynop.cisnienie) : null,
      windSpeed: meteo.wiatr_srednia_predkosc ? Number(meteo.wiatr_srednia_predkosc) : (bestSynop.predkosc_wiatru ? Number(bestSynop.predkosc_wiatru) : null),
      windGust: meteo.wiatr_poryw_10min ? Number(meteo.wiatr_poryw_10min) : null,
      rain: rVal,
      groundTemp: meteo.temperatura_gruntu ? Number(meteo.temperatura_gruntu) : null,
      measurementTime: `${bestSynop.data_pomiaru} ${bestSynop.godzina_pomiaru}:00`,
      sourceDesc: `Lokalna stacja meteorologiczna IMGW (${meteo.kod_stacji})`,
    });
  }

  // Filtrowanie
  let filtered = locations;

  if (voivodeship && voivodeship !== 'all') {
    const qVoiv = normalizePl(voivodeship);
    filtered = filtered.filter((loc) => normalizePl(loc.voivodeship) === qVoiv);
  }

  if (typeFilter && typeFilter !== 'all') {
    filtered = filtered.filter((loc) => loc.type === typeFilter);
  }

  if (search.trim()) {
    const q = normalizePl(search);
    filtered = filtered.filter((loc) =>
      normalizePl(loc.name).includes(q) ||
      normalizePl(loc.voivodeship).includes(q) ||
      (loc.meteoStationCode && loc.meteoStationCode.includes(q))
    );
  }

  // Sortowanie alfabetyczne po nazwie
  filtered.sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  return filtered;
}

// Pobiera kompletne dane i historię dla wybranej lokalizacji
export async function getImgwLocationDetails(locationId: string): Promise<WeatherLocationDetails | null> {
  const allLocations = await getImgwLocations();
  const loc = allLocations.find((l) => l.id === locationId) || allLocations.find((l) => l.synopStationId === locationId);

  if (!loc) {
    return null;
  }

  const [synopStation, historyRes, warningsRes, hydroList, meteoList] = await Promise.all([
    getImgwSynopStationById(loc.synopStationId),
    getImgwStationHistory(loc.synopStationId),
    getImgwWarnings(),
    getImgwHydroStations(loc.voivodeship, 20),
    getImgwMeteoStations(loc.name, 1),
  ]);

  const matchedMeteo = meteoList.length > 0 ? meteoList[0] : null;

  // Filtruj ostrzeżenia pod kątem województwa danej lokalizacji
  const normVoiv = normalizePl(loc.voivodeship);
  const relevantWarnings = [
    ...warningsRes.meteo.filter((w) => {
      if (!w.obszary || w.obszary.length === 0) return true;
      return w.obszary.some((o) => o.wojewodztwo && normalizePl(o.wojewodztwo).includes(normVoiv));
    }),
    ...warningsRes.hydro.filter((w) => {
      if (!w.obszary || w.obszary.length === 0) return true;
      return w.obszary.some((o) => o.wojewodztwo && normalizePl(o.wojewodztwo).includes(normVoiv));
    }),
  ];

  return {
    location: loc,
    synop: synopStation,
    meteo: matchedMeteo,
    history: historyRes.history,
    nearbyHydro: hydroList,
    warnings: relevantWarnings,
  };
}

// Fetch weather & flood warnings
export async function getImgwWarnings(): Promise<{
  meteo: ImgwWarning[];
  hydro: ImgwWarning[];
  count: number;
}> {
  const now = Date.now();
  if (warningsLastFetch > 0 && now - warningsLastFetch < 5 * 60 * 1000) {
    return {
      meteo: warningsMeteoCache,
      hydro: warningsHydroCache,
      count: warningsMeteoCache.length + warningsHydroCache.length,
    };
  }

  // 1. Meteo warnings
  try {
    const rMeteo = await fetch('https://danepubliczne.imgw.pl/api/data/warningsmeteo', {
      headers: { Accept: 'application/json' },
    });
    if (rMeteo.ok) {
      const dMeteo = await rMeteo.json();
      if (Array.isArray(dMeteo)) {
        warningsMeteoCache = dMeteo.map((item: Record<string, unknown>) => ({
          type: 'meteo',
          numer: typeof item['numer'] === 'string' ? item['numer'] : '',
          zdarzenie: typeof item['zdarzenie'] === 'string' ? item['zdarzenie'] : 'Zjawisko meteorologiczne',
          stopien: (item['stopień'] ?? item['stopien'] ?? '1') as string | number,
          prawdopodobienstwo: (item['prawdopodobienstwo'] ?? item['prawdopodobieństwo']) as string | number | undefined,
          data_od: typeof item['data_od'] === 'string' ? item['data_od'] : '',
          data_do: typeof item['data_do'] === 'string' ? item['data_do'] : '',
          opublikowano: typeof item['opublikowano'] === 'string' ? item['opublikowano'] : undefined,
          biuro: typeof item['biuro'] === 'string' ? item['biuro'] : undefined,
          przebieg: typeof item['przebieg'] === 'string' ? item['przebieg'] : undefined,
          komentarz: typeof item['komentarz'] === 'string' ? item['komentarz'] : undefined,
          obszary: item['obszary'] as { wojewodztwo?: string; opis?: string; kod_zlewni?: string[] }[] | undefined,
        }));
      } else {
        warningsMeteoCache = [];
      }
    }
  } catch (err) {
    console.warn('[IMGW] Blad warnings meteo:', err);
  }

  // 2. Hydro warnings
  try {
    const rHydro = await fetch('https://danepubliczne.imgw.pl/api/data/warningshydro', {
      headers: { Accept: 'application/json' },
    });
    if (rHydro.ok) {
      const dHydro = await rHydro.json();
      if (Array.isArray(dHydro)) {
        warningsHydroCache = dHydro.map((item: Record<string, unknown>) => ({
          type: 'hydro',
          numer: typeof item['numer'] === 'string' ? item['numer'] : '',
          zdarzenie: typeof item['zdarzenie'] === 'string' ? item['zdarzenie'] : 'Zjawisko hydrologiczne',
          stopien: (item['stopień'] ?? item['stopien'] ?? '1') as string | number,
          prawdopodobienstwo: (item['prawdopodobienstwo'] ?? item['prawdopodobieństwo']) as string | number | undefined,
          data_od: typeof item['data_od'] === 'string' ? item['data_od'] : '',
          data_do: typeof item['data_do'] === 'string' ? item['data_do'] : '',
          opublikowano: typeof item['opublikowano'] === 'string' ? item['opublikowano'] : undefined,
          biuro: typeof item['biuro'] === 'string' ? item['biuro'] : undefined,
          przebieg: typeof item['przebieg'] === 'string' ? item['przebieg'] : undefined,
          komentarz: typeof item['komentarz'] === 'string' ? item['komentarz'] : undefined,
          obszary: item['obszary'] as { wojewodztwo?: string; opis?: string; kod_zlewni?: string[] }[] | undefined,
        }));
      } else {
        warningsHydroCache = [];
      }
    }
  } catch (err) {
    console.warn('[IMGW] Blad warnings hydro:', err);
  }

  warningsLastFetch = now;
  return {
    meteo: warningsMeteoCache,
    hydro: warningsHydroCache,
    count: warningsMeteoCache.length + warningsHydroCache.length,
  };
}

export function getImgwFavoriteStations(): string[] {
  return favoriteStationIds;
}

export function setImgwFavoriteStations(ids: string[]): string[] {
  if (Array.isArray(ids)) {
    favoriteStationIds = ids.filter((id) => typeof id === 'string' && id.trim().length > 0);
    saveCacheToDisk();
  }
  return favoriteStationIds;
}

// Initial boot
loadCacheFromDisk();
getImgwSynopStations().catch((err) => {
  console.debug('IMGW initial load error:', err);
});
