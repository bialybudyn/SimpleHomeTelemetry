import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import { Device } from '../../models/telemetry.models';

type FilterCategory = 'all' | 'active' | 'disconnected' | 'deleted';
type SortField = 'added_at' | 'last_seen' | 'name' | 'ieee' | 'category';
type SortDirection = 'asc' | 'desc';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-devices-manager',
  imports: [MatIconModule],
  template: `
    <div class="space-y-6">
      <!-- Nagłówek i Statystyki Urządzeń -->
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 mb-2">
            <mat-icon class="text-xs !w-3.5 !h-3.5">devices_other</mat-icon>
            <span>Zarządzanie Flotą Urządzeń</span>
          </div>
          <h3 class="text-xl font-bold text-white tracking-tight">
            Centrum Zarządzania Urządzeniami (Zigbee & Wi-Fi)
          </h3>
          <p class="text-xs text-slate-400 mt-1 max-w-2xl">
            Pełny rejestr urządzeń podzielony na 3 kategorie: <strong class="text-emerald-400">Aktywne</strong>, <strong class="text-amber-400">Niepołączone</strong> oraz <strong class="text-rose-400">Usunięte z pulpitu</strong>. Wszystkie operacje są natychmiast rejestrowane w logach backendu.
          </p>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button
            (click)="triggerAutoDiscover()"
            [disabled]="telemetry.isAutoDiscovering()"
            class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/40 transition-all cursor-pointer disabled:opacity-50"
            title="Skanuj podsieć DongleMAX i sieć Zigbee w poszukiwaniu nowych gniazdek i urządzeń"
          >
            <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isAutoDiscovering()">manage_search</mat-icon>
            <span>{{ telemetry.isAutoDiscovering() ? 'Skanowanie...' : '⚡ Auto-wyszukiwanie DongleMAX' }}</span>
          </button>
          <button
            (click)="purgeAllDevices()"
            class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-xs font-semibold border border-rose-800/80 transition-all cursor-pointer"
            title="Usuń przykładowe oraz zarejestrowane urządzenia i wyczyść historię"
          >
            <mat-icon class="text-sm !w-4 !h-4 text-rose-400">delete_sweep</mat-icon>
            <span>Wyczyść rejestr urządzeń</span>
          </button>
          <button
            (click)="refreshData()"
            [disabled]="telemetry.isActionProcessing()"
            class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
            title="Odśwież listę urządzeń z serwera"
          >
            <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isActionProcessing()">refresh</mat-icon>
            <span>Odśwież</span>
          </button>
          <button
            (click)="showLogsModal.set(!showLogsModal())"
            class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
            title="Wyświetl dziennik zdarzeń backendu"
          >
            <mat-icon class="text-sm !w-4 !h-4 text-indigo-400">history</mat-icon>
            <span>Dziennik logów ({{ telemetry.deviceAuditLogs().length }})</span>
          </button>
        </div>
      </div>

      <!-- Kafelki podsumowania 3 kategorii -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- 1. Aktywne -->
        <button
          type="button"
          (click)="selectedCategoryFilter.set('active')"
          class="p-4 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden group w-full"
          [class.bg-emerald-950/20]="selectedCategoryFilter() === 'active'"
          [class.border-emerald-500/50]="selectedCategoryFilter() === 'active'"
          [class.bg-slate-900/60]="selectedCategoryFilter() !== 'active'"
          [class.border-slate-800]="selectedCategoryFilter() !== 'active'"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/80 animate-pulse"></span>
              Aktywne Urządzenia
            </span>
            <mat-icon class="text-emerald-400 text-lg !w-5 !h-5 opacity-70">sensors</mat-icon>
          </div>
          <div class="text-3xl font-extrabold text-white font-mono tabular-nums">
            {{ activeDevicesCount() }}
          </div>
          <p class="text-[11px] text-slate-400 mt-1">
            Wysyłają dane w sieci, w pełni sprawne
          </p>
        </button>

        <!-- 2. Niepołączone -->
        <button
          type="button"
          (click)="selectedCategoryFilter.set('disconnected')"
          class="p-4 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden group w-full"
          [class.bg-amber-950/20]="selectedCategoryFilter() === 'disconnected'"
          [class.border-amber-500/50]="selectedCategoryFilter() === 'disconnected'"
          [class.bg-slate-900/60]="selectedCategoryFilter() !== 'disconnected'"
          [class.border-slate-800]="selectedCategoryFilter() !== 'disconnected'"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/80"></span>
              Niepołączone (Offline)
            </span>
            <mat-icon class="text-amber-400 text-lg !w-5 !h-5 opacity-70">signal_cellular_connected_no_internet_0_bar</mat-icon>
          </div>
          <div class="text-3xl font-extrabold text-white font-mono tabular-nums">
            {{ disconnectedDevicesCount() }}
          </div>
          <p class="text-[11px] text-slate-400 mt-1">
            Brak pakietów w ostatnim czasie lub błąd LAN
          </p>
        </button>

        <!-- 3. Usunięte z pulpitu -->
        <button
          type="button"
          (click)="selectedCategoryFilter.set('deleted')"
          class="p-4 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden group w-full"
          [class.bg-rose-950/20]="selectedCategoryFilter() === 'deleted'"
          [class.border-rose-500/50]="selectedCategoryFilter() === 'deleted'"
          [class.bg-slate-900/60]="selectedCategoryFilter() !== 'deleted'"
          [class.border-slate-800]="selectedCategoryFilter() !== 'deleted'"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-rose-400 flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              Usunięte z Pulpitu
            </span>
            <mat-icon class="text-rose-400 text-lg !w-5 !h-5 opacity-70">archive</mat-icon>
          </div>
          <div class="text-3xl font-extrabold text-white font-mono tabular-nums">
            {{ deletedDevicesCount() }}
          </div>
          <p class="text-[11px] text-slate-400 mt-1">
            Ukryte z pulpitu, historia pomiarów zachowana
          </p>
        </button>
      </div>

      <!-- Pasek filtrów, wyszukiwania, sortowania i operacji grupowych -->
      <div class="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 shadow-lg">
        <div class="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <!-- Filtry 4 zakładek kategorii -->
          <div class="flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto text-xs font-semibold">
            <button
              (click)="selectedCategoryFilter.set('all')"
              class="px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer"
              [class.bg-slate-800]="selectedCategoryFilter() === 'all'"
              [class.text-white]="selectedCategoryFilter() === 'all'"
              [class.text-slate-400]="selectedCategoryFilter() !== 'all'"
            >
              Wszystkie ({{ allDevices().length }})
            </button>
            <button
              (click)="selectedCategoryFilter.set('active')"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer"
              [class.bg-emerald-950/60]="selectedCategoryFilter() === 'active'"
              [class.text-emerald-300]="selectedCategoryFilter() === 'active'"
              [class.border]="selectedCategoryFilter() === 'active'"
              [class.border-emerald-500/30]="selectedCategoryFilter() === 'active'"
              [class.text-slate-400]="selectedCategoryFilter() !== 'active'"
            >
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Aktywne ({{ activeDevicesCount() }})</span>
            </button>
            <button
              (click)="selectedCategoryFilter.set('disconnected')"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer"
              [class.bg-amber-950/60]="selectedCategoryFilter() === 'disconnected'"
              [class.text-amber-300]="selectedCategoryFilter() === 'disconnected'"
              [class.border]="selectedCategoryFilter() === 'disconnected'"
              [class.border-amber-500/30]="selectedCategoryFilter() === 'disconnected'"
              [class.text-slate-400]="selectedCategoryFilter() !== 'disconnected'"
            >
              <span class="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>Niepołączone ({{ disconnectedDevicesCount() }})</span>
            </button>
            <button
              (click)="selectedCategoryFilter.set('deleted')"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer"
              [class.bg-rose-950/60]="selectedCategoryFilter() === 'deleted'"
              [class.text-rose-300]="selectedCategoryFilter() === 'deleted'"
              [class.border]="selectedCategoryFilter() === 'deleted'"
              [class.border-rose-500/30]="selectedCategoryFilter() === 'deleted'"
              [class.text-slate-400]="selectedCategoryFilter() !== 'deleted'"
            >
              <span class="w-2 h-2 rounded-full bg-rose-500"></span>
              <span>Usunięte ({{ deletedDevicesCount() }})</span>
            </button>
          </div>

          <!-- Wyszukiwarka -->
          <div class="relative flex-1 max-w-md">
            <mat-icon class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm !w-4 !h-4">search</mat-icon>
            <input
              type="text"
              [value]="searchQuery()"
              (input)="searchQuery.set($any($event.target).value)"
              placeholder="Szukaj po nazwie, adresie IEEE, IP lub modelu..."
              class="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono transition-colors"
            />
            @if (searchQuery()) {
              <button
                (click)="searchQuery.set('')"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-0.5 cursor-pointer"
                title="Wyczyść szukanie"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5">close</mat-icon>
              </button>
            }
          </div>

          <!-- Sortowanie -->
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-400 whitespace-nowrap hidden sm:inline">Sortuj:</span>
            <select
              [value]="sortBy()"
              (change)="setSortBy($any($event.target).value)"
              class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium cursor-pointer"
            >
              <option value="added_at">Data dodania urządzenia</option>
              <option value="last_seen">Ostatnia aktywność (Last Seen)</option>
              <option value="name">Nazwa urządzenia (A-Z)</option>
              <option value="ieee">Identyfikator IEEE / IP</option>
              <option value="category">Kategoria urządzenia</option>
            </select>
            <button
              (click)="toggleSortDirection()"
              class="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
              [title]="sortDirection() === 'asc' ? 'Kolejność rosnąca (kliknij aby zmienić)' : 'Kolejność malejąca (kliknij aby zmienić)'"
            >
              <mat-icon class="text-sm !w-4 !h-4">
                {{ sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}
              </mat-icon>
            </button>
          </div>
        </div>

        <!-- Pasek Operacji Zbiorczych (Widoczny gdy zaznaczono elementy) -->
        <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                [checked]="isAllSelected()"
                [indeterminate]="isPartiallySelected()"
                (change)="toggleSelectAll()"
                class="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0 cursor-pointer"
              />
              <span class="font-semibold">Zaznacz wszystko w widoku ({{ filteredAndSortedDevices().length }})</span>
            </label>

            @if (selectedIeeeList().size > 0) {
              <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                Wybrano: {{ selectedIeeeList().size }}
              </span>
            }
          </div>

          @if (selectedIeeeList().size > 0) {
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs text-slate-400 mr-1 hidden sm:inline">Akcja dla zaznaczonych:</span>

              <button
                (click)="batchAction('restore')"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition-all cursor-pointer shadow-sm"
                title="Przywróć zaznaczone urządzenia do Pulpitu na żywo"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5">restore</mat-icon>
                <span>Przywróć na pulpit ({{ selectedIeeeList().size }})</span>
              </button>

              <button
                (click)="batchAction('soft_delete')"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all cursor-pointer shadow-sm"
                title="Usuń z pulpitu na żywo (zachowaj historię)"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5">visibility_off</mat-icon>
                <span>Usuń z pulpitu ({{ selectedIeeeList().size }})</span>
              </button>

              <button
                (click)="openBatchPermanentDeleteModal()"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-rose-950/60"
                title="TRWAŁE USUNIĘCIE: Kasuje historię i konfigurację!"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5">delete_forever</mat-icon>
                <span>PERMANENTNE USUNIĘCIE ({{ selectedIeeeList().size }})</span>
              </button>

              <button
                (click)="clearSelection()"
                class="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 cursor-pointer"
              >
                Odznacz
              </button>
            </div>
          }
        </div>
      </div>

      <!-- Tabela / Lista Urządzeń -->
      <div class="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-xl">
        @if (filteredAndSortedDevices().length === 0) {
          <div class="p-12 text-center space-y-3">
            <mat-icon class="text-4xl !w-10 !h-10 text-slate-600">search_off</mat-icon>
            <p class="text-sm font-semibold text-slate-300">Brak urządzeń spełniających wybrane kryteria.</p>
            <p class="text-xs text-slate-500">Zmień filtr kategorii lub wpisaną frazę w wyszukiwarce.</p>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead>
                <tr class="bg-slate-950 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th class="py-3 px-3 w-10 text-center">
                    <span class="sr-only">Wybór</span>
                  </th>
                  <th class="py-3 px-3">Urządzenie & Model</th>
                  <th class="py-3 px-3">Status Sieci</th>
                  <th class="py-3 px-3">Data Dodania</th>
                  <th class="py-3 px-3">Ostatnia Aktywność</th>
                  <th class="py-3 px-3">Protokół / Klucz</th>
                  <th class="py-3 px-3 text-right">Akcje Zarządzania</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60 font-sans">
                @for (dev of filteredAndSortedDevices(); track dev.ieee_address) {
                  <tr
                    class="hover:bg-slate-800/40 transition-colors"
                    [class.bg-rose-950/10]="dev.is_deleted"
                    [class.bg-slate-850]="selectedIeeeList().has(dev.ieee_address)"
                  >
                    <!-- Checkbox zaznaczenia -->
                    <td class="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        [checked]="selectedIeeeList().has(dev.ieee_address)"
                        (change)="toggleDeviceSelection(dev.ieee_address)"
                        class="w-4 h-4 rounded border-slate-700 bg-slate-950 text-cyan-600 focus:ring-0 cursor-pointer"
                      />
                    </td>

                    <!-- Nazwa i model -->
                    <td class="py-3 px-3">
                      <div class="flex items-start gap-2.5">
                        <div class="p-2 rounded-lg bg-slate-950 border border-slate-800 shrink-0 text-slate-300">
                          <mat-icon class="text-base !w-4 !h-4">{{ getCategoryIcon(dev) }}</mat-icon>
                        </div>
                        <div class="min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="font-bold text-white text-sm truncate" [class.line-through]="dev.is_deleted" [class.text-slate-400]="dev.is_deleted">
                              {{ dev.friendly_name || dev.ieee_address }}
                            </span>
                            <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                              {{ dev.category || 'urządzenie' }}
                            </span>
                          </div>
                          <div class="flex items-center gap-2 text-[11px] font-mono text-slate-400 mt-0.5">
                            <span class="truncate">{{ dev.model }}</span>
                            <span class="text-slate-600">•</span>
                            <span class="text-slate-500 truncate">{{ dev.ieee_address }}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <!-- Status Sieci (Aktywne / Niepołączone / Usunięte) -->
                    <td class="py-3 px-3 whitespace-nowrap">
                      @if (dev.is_deleted) {
                        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                          <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          <span>Usunięte z pulpitu</span>
                        </span>
                      } @else if (isOnline(dev)) {
                        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          <span>Aktywne (Online)</span>
                        </span>
                      } @else {
                        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                          <span>Niepołączone (Offline)</span>
                        </span>
                      }
                      @if (dev.last_error) {
                        <div class="text-[10px] text-rose-400 font-mono truncate max-w-[200px] mt-0.5" [title]="dev.last_error">
                          {{ dev.last_error }}
                        </div>
                      }
                    </td>

                    <!-- Data Dodania Urządzenia -->
                    <td class="py-3 px-3 whitespace-nowrap">
                      <div class="flex items-center gap-1.5 text-slate-300 font-mono text-xs">
                        <mat-icon class="text-xs !w-3.5 !h-3.5 text-slate-500">calendar_today</mat-icon>
                        <span>{{ formatAddedDate(dev) }}</span>
                      </div>
                      <span class="text-[10px] text-slate-500 block font-sans">Rejestracja w systemie</span>
                    </td>

                    <!-- Ostatnia Aktywność -->
                    <td class="py-3 px-3 whitespace-nowrap">
                      <div class="flex items-center gap-1.5 text-slate-300 font-mono text-xs">
                        <mat-icon class="text-xs !w-3.5 !h-3.5 text-slate-500">schedule</mat-icon>
                        <span [title]="dev.last_seen || 'brak'">{{ formatLastSeen(dev) }}</span>
                      </div>
                      @if (dev.linkquality !== null && dev.linkquality !== undefined) {
                        <span class="text-[10px] text-slate-500 block font-mono">{{ dev.linkquality }} LQI sygnał</span>
                      }
                    </td>

                    <!-- Protokół / Klucz Local Key -->
                    <td class="py-3 px-3 whitespace-nowrap font-mono text-[11px]">
                      @if (dev.protocol === 'wifi' || dev.ip_address) {
                        <div class="flex items-center gap-1 text-indigo-400">
                          <mat-icon class="text-xs !w-3.5 !h-3.5">wifi</mat-icon>
                          <span>Wi-Fi ({{ dev.ip_address || 'brak IP' }})</span>
                        </div>
                        @if (dev.local_key) {
                          <span class="text-[10px] text-emerald-400 block" [title]="'Pełny klucz: ' + dev.local_key">
                            Local Key: ••••{{ dev.local_key.slice(-4) }}
                          </span>
                        } @else {
                          <span class="text-[10px] text-amber-500 block">Brak Local Key</span>
                        }
                      } @else {
                        <div class="flex items-center gap-1 text-cyan-400">
                          <mat-icon class="text-xs !w-3.5 !h-3.5">hub</mat-icon>
                          <span>Zigbee 3.0</span>
                        </div>
                      }
                    </td>

                    <!-- Akcje Zarządzania -->
                    <td class="py-3 px-3 text-right whitespace-nowrap">
                      <div class="flex items-center justify-end gap-1.5">
                        <!-- Test połączenia -->
                        <button
                          (click)="testConnection(dev)"
                          class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                          title="Przetestuj połączenie z urządzeniem"
                        >
                          <mat-icon class="text-xs !w-3.5 !h-3.5">network_check</mat-icon>
                        </button>

                        <!-- Soft delete LUB Restore -->
                        @if (dev.is_deleted) {
                          <button
                            (click)="restoreDevice(dev)"
                            class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-bold text-xs transition-colors cursor-pointer shadow-sm"
                            title="Przywróć urządzenie na Pulpit na żywo"
                          >
                            <mat-icon class="text-xs !w-3.5 !h-3.5">restore</mat-icon>
                            <span>Przywróć</span>
                          </button>
                        } @else {
                          <button
                            (click)="confirmSoftDelete(dev)"
                            class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600/15 hover:bg-amber-600/25 text-amber-300 border border-amber-500/30 font-semibold text-xs transition-colors cursor-pointer"
                            title="Usuń z Pulpitu na żywo (zachowuje całą historię w razie ponownego połączenia)"
                          >
                            <mat-icon class="text-xs !w-3.5 !h-3.5">visibility_off</mat-icon>
                            <span>Usuń z pulpitu</span>
                          </button>
                        }

                        <!-- PERMANENTNE USUNIĘCIE URZĄDZENIA -->
                        <button
                          (click)="openPermanentDeleteModal(dev)"
                          class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-bold text-xs transition-all cursor-pointer shadow-sm"
                          title="PERMANENTNE USUNIĘCIE: Kasuje urządzenie ORAZ całą jego historię pomiarów!"
                        >
                          <mat-icon class="text-xs !w-3.5 !h-3.5">delete_forever</mat-icon>
                          <span>Trwałe usunięcie</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- MODAL POTWIERDZENIA PERMANENTNEGO USUNIĘCIA URZĄDZENIA -->
      @if (permanentTargetDevice()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div class="bg-slate-900 border-2 border-rose-600 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl text-left">
            <div class="flex items-center gap-3 text-rose-400">
              <div class="p-3 rounded-xl bg-rose-600/20 border border-rose-500/30">
                <mat-icon class="text-2xl !w-7 !h-7 text-rose-500">warning</mat-icon>
              </div>
              <div>
                <h4 class="text-lg font-bold text-white">PERMANENTNE USUNIĘCIE URZĄDZENIA</h4>
                <p class="text-xs text-rose-300 font-medium">Operacja jest nieodwracalna!</p>
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200 space-y-2">
              <p>
                Zamierzasz <strong>trwale usunąć urządzenie</strong>:
              </p>
              <div class="p-2.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-white">
                <div class="font-bold text-sm">{{ permanentTargetDevice()?.friendly_name }}</div>
                <div class="text-[11px] text-slate-400 mt-0.5">Adres IEEE / IP: {{ permanentTargetDevice()?.ieee_address }}</div>
                <div class="text-[11px] text-slate-400">Model: {{ permanentTargetDevice()?.model }}</div>
              </div>
              <p class="font-semibold text-rose-300">
                ⚠️ Uwaga: Zostaną bezpowrotnie usunięte:
              </p>
              <ul class="list-disc list-inside space-y-1 text-slate-300 pl-1">
                <li>Wszystkie historyczne dane pomiarowe (temperatura, wilgotność, prąd, moc, stan)</li>
                <li>Wpisy z bazy danych serwera (telemetry_cache.json i devices_cache.json)</li>
                <li>Rejestracja w oprogramowaniu Zigbee2MQTT / sterownikach Wi-Fi</li>
              </ul>
            </div>

            <div class="flex items-center justify-end gap-3 pt-2">
              <button
                (click)="permanentTargetDevice.set(null)"
                class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Anuluj
              </button>
              <button
                (click)="executePermanentDelete()"
                [disabled]="telemetry.isActionProcessing()"
                class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-950/60 transition-all cursor-pointer disabled:opacity-50"
              >
                <mat-icon class="text-sm !w-4 !h-4">delete_forever</mat-icon>
                <span>POTWIERDZAM: USUŃ TRWALE WSZYSTKIE DANE</span>
              </button>
            </div>
          </div>
        </div>
      }

      <!-- MODAL POTWIERDZENIA ZBIORCZEGO TRWAŁEGO USUNIĘCIA -->
      @if (showBatchPermanentModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div class="bg-slate-900 border-2 border-rose-600 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl text-left">
            <div class="flex items-center gap-3 text-rose-400">
              <div class="p-3 rounded-xl bg-rose-600/20 border border-rose-500/30">
                <mat-icon class="text-2xl !w-7 !h-7 text-rose-500">warning</mat-icon>
              </div>
              <div>
                <h4 class="text-lg font-bold text-white">TRWAŁE USUNIĘCIE {{ selectedIeeeList().size }} URZĄDZEŃ</h4>
                <p class="text-xs text-rose-300 font-medium">Zbiorcze bezpowrotne wykasowanie danych</p>
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200 space-y-2">
              <p>
                Czy na pewno chcesz <strong>trwale usunąć {{ selectedIeeeList().size }} zaznaczonych urządzeń</strong> wraz z całą ich historią telemetrii?
              </p>
              <p class="text-slate-300">
                Wszystkie punkty historii wykresów, powiązania i konfiguracje zostaną bezpowrotnie usunięte z dysku i pamięci serwera.
              </p>
            </div>

            <div class="flex items-center justify-end gap-3 pt-2">
              <button
                (click)="showBatchPermanentModal.set(false)"
                class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Anuluj
              </button>
              <button
                (click)="executeBatchPermanentDelete()"
                [disabled]="telemetry.isActionProcessing()"
                class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-950/60 transition-all cursor-pointer disabled:opacity-50"
              >
                <mat-icon class="text-sm !w-4 !h-4">delete_forever</mat-icon>
                <span>USUŃ TRWALE {{ selectedIeeeList().size }} URZĄDZEŃ</span>
              </button>
            </div>
          </div>
        </div>
      }

      <!-- MODAL LOGÓW AUDYTOWYCH BACKENDU -->
      @if (showLogsModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 space-y-4 shadow-2xl flex flex-col max-h-[85vh]">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2 text-white">
                <mat-icon class="text-indigo-400">history</mat-icon>
                <h4 class="text-base font-bold">Dziennik Audytowy Backendu (Logi Urządzeń)</h4>
              </div>
              <button
                (click)="showLogsModal.set(false)"
                class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
              </button>
            </div>

            <p class="text-xs text-slate-400">
              Wszystkie akcje usunięcia z pulpitu, przywrócenia, trwałego kasowania oraz ponownego dołączenia urządzeń są rejestrowane na serwerze z dokładnym znacznikiem czasu.
            </p>

            <div class="overflow-y-auto flex-1 space-y-2 pr-1 custom-scrollbar">
              @if (telemetry.deviceAuditLogs().length === 0) {
                <div class="text-center py-8 text-xs text-slate-500 italic">Brak zarejestrowanych wpisów w dzienniku audytu.</div>
              } @else {
                @for (log of telemetry.deviceAuditLogs(); track log.id) {
                  <div class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs space-y-1">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="font-bold text-white flex items-center gap-1.5">
                        <span class="px-1.5 py-0.5 rounded font-mono text-[9px] uppercase font-bold"
                          [class.bg-rose-500/20]="log.action === 'permanent_delete'"
                          [class.text-rose-400]="log.action === 'permanent_delete'"
                          [class.bg-amber-500/20]="log.action === 'soft_delete'"
                          [class.text-amber-400]="log.action === 'soft_delete'"
                          [class.bg-emerald-500/20]="log.action === 'restore' || log.action === 'reconnected'"
                          [class.text-emerald-400]="log.action === 'restore' || log.action === 'reconnected'"
                          [class.bg-cyan-500/20]="log.action === 'created'"
                          [class.text-cyan-400]="log.action === 'created'"
                        >
                          {{ log.action }}
                        </span>
                        <span>{{ log.device_name || log.device_ieee }}</span>
                      </span>
                      <span class="font-mono text-slate-500">{{ formatTimestamp(log.timestamp) }}</span>
                    </div>
                    <p class="text-slate-300 font-mono text-[11px]">{{ log.message }}</p>
                  </div>
                }
              }
            </div>

            <div class="flex items-center justify-end pt-2 border-t border-slate-800">
              <button
                (click)="showLogsModal.set(false)"
                class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class DevicesManager {
  readonly telemetry = inject(Telemetry);

  readonly selectedCategoryFilter = signal<FilterCategory>('all');
  readonly searchQuery = signal<string>('');
  readonly sortBy = signal<SortField>('added_at');
  readonly sortDirection = signal<SortDirection>('desc');
  readonly selectedIeeeList = signal<Set<string>>(new Set());

  readonly permanentTargetDevice = signal<Device | null>(null);
  readonly showBatchPermanentModal = signal<boolean>(false);
  readonly showLogsModal = signal<boolean>(false);

  // Lista wszystkich urządzeń z serwera (w tym usuniętych z pulpitu)
  readonly allDevices = computed(() => {
    return this.telemetry.allDevices();
  });

  readonly activeDevicesCount = computed(() => {
    return this.allDevices().filter((d) => !d.is_deleted && this.isOnline(d)).length;
  });

  readonly disconnectedDevicesCount = computed(() => {
    return this.allDevices().filter((d) => !d.is_deleted && !this.isOnline(d)).length;
  });

  readonly deletedDevicesCount = computed(() => {
    return this.allDevices().filter((d) => d.is_deleted).length;
  });

  readonly filteredAndSortedDevices = computed(() => {
    const list = this.allDevices();
    const cat = this.selectedCategoryFilter();
    const query = this.searchQuery().trim().toLowerCase();
    const field = this.sortBy();
    const dir = this.sortDirection();

    // 1. Filtr kategorii
    let filtered = list.filter((d) => {
      if (cat === 'active') return !d.is_deleted && this.isOnline(d);
      if (cat === 'disconnected') return !d.is_deleted && !this.isOnline(d);
      if (cat === 'deleted') return !!d.is_deleted;
      return true;
    });

    // 2. Szukanie frazy
    if (query) {
      filtered = filtered.filter((d) => {
        const name = (d.friendly_name || '').toLowerCase();
        const ieee = (d.ieee_address || '').toLowerCase();
        const ip = (d.ip_address || '').toLowerCase();
        const model = (d.model || '').toLowerCase();
        const vendor = (d.vendor || '').toLowerCase();
        return name.includes(query) || ieee.includes(query) || ip.includes(query) || model.includes(query) || vendor.includes(query);
      });
    }

    // 3. Sortowanie
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (field === 'added_at') {
        const timeA = a.added_at || a.first_seen || a.last_seen || '';
        const timeB = b.added_at || b.first_seen || b.last_seen || '';
        cmp = timeA.localeCompare(timeB);
      } else if (field === 'last_seen') {
        const timeA = a.last_seen || '';
        const timeB = b.last_seen || '';
        cmp = timeA.localeCompare(timeB);
      } else if (field === 'name') {
        const nameA = (a.friendly_name || a.ieee_address).toLowerCase();
        const nameB = (b.friendly_name || b.ieee_address).toLowerCase();
        cmp = nameA.localeCompare(nameB);
      } else if (field === 'ieee') {
        cmp = (a.ieee_address || '').localeCompare(b.ieee_address || '');
      } else if (field === 'category') {
        cmp = (a.category || '').localeCompare(b.category || '');
      }

      return dir === 'asc' ? cmp : -cmp;
    });
  });

  isOnline(d: Device): boolean {
    if (d.is_deleted) return false;
    if (d.connection_status === 'offline') return false;
    if (!d.last_seen) return false;
    const ms = new Date(d.last_seen).getTime();
    if (isNaN(ms)) return false;
    // Do 60 minut uznajemy za aktywne
    return (Date.now() - ms) <= 60 * 60 * 1000;
  }

  isAllSelected(): boolean {
    const list = this.filteredAndSortedDevices();
    if (list.length === 0) return false;
    const selected = this.selectedIeeeList();
    return list.every((d) => selected.has(d.ieee_address));
  }

  isPartiallySelected(): boolean {
    const list = this.filteredAndSortedDevices();
    const selected = this.selectedIeeeList();
    const count = list.filter((d) => selected.has(d.ieee_address)).length;
    return count > 0 && count < list.length;
  }

  toggleSelectAll(): void {
    const current = new Set(this.selectedIeeeList());
    const list = this.filteredAndSortedDevices();
    if (this.isAllSelected()) {
      for (const d of list) {
        current.delete(d.ieee_address);
      }
    } else {
      for (const d of list) {
        current.add(d.ieee_address);
      }
    }
    this.selectedIeeeList.set(current);
  }

  toggleDeviceSelection(ieee: string): void {
    const current = new Set(this.selectedIeeeList());
    if (current.has(ieee)) {
      current.delete(ieee);
    } else {
      current.add(ieee);
    }
    this.selectedIeeeList.set(current);
  }

  clearSelection(): void {
    this.selectedIeeeList.set(new Set());
  }

  setSortBy(val: string): void {
    this.sortBy.set(val as SortField);
  }

  toggleSortDirection(): void {
    this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
  }

  refreshData(): void {
    this.telemetry.fetchAdminDevices();
    this.telemetry.fetchDevices();
  }

  getCategoryIcon(dev: Device): string {
    const cat = dev.category;
    if (cat === 'fan') return 'mode_fan';
    if (cat === 'plug') return 'power';
    if (cat === 'switch') return 'toggle_on';
    if (cat === 'climate') return 'thermostat';
    if (cat === 'smoke') return 'local_fire_department';
    if (cat === 'water_leak') return 'water';
    if (cat === 'contact') return 'sensor_door';
    if (cat === 'occupancy') return 'motion_photos_on';
    return 'sensors';
  }

  formatAddedDate(dev: Device): string {
    const raw = dev.added_at || dev.first_seen || dev.last_seen;
    if (!raw) return 'brak danych';
    try {
      const dt = new Date(raw);
      if (isNaN(dt.getTime())) return 'brak danych';
      const day = String(dt.getDate()).padStart(2, '0');
      const month = String(dt.getMonth() + 1).padStart(2, '0');
      const year = dt.getFullYear();
      const hours = String(dt.getHours()).padStart(2, '0');
      const minutes = String(dt.getMinutes()).padStart(2, '0');
      return `${day}.${month}.${year} ${hours}:${minutes}`;
    } catch {
      return 'brak danych';
    }
  }

  formatLastSeen(dev: Device): string {
    if (!dev.last_seen) return 'brak danych';
    try {
      const dt = new Date(dev.last_seen);
      if (isNaN(dt.getTime())) return 'brak danych';
      const diffSec = Math.floor((Date.now() - dt.getTime()) / 1000);
      if (diffSec < 60) return 'przed chwilą';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min temu`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} godz. temu`;
      return `${Math.floor(diffSec / 86400)} dni temu`;
    } catch {
      return 'brak danych';
    }
  }

  formatTimestamp(isoStr: string): string {
    if (!isoStr) return '';
    try {
      const dt = new Date(isoStr);
      return dt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoStr;
    }
  }

  confirmSoftDelete(dev: Device): void {
    if (confirm(`Czy na pewno chcesz usunąć urządzenie "${dev.friendly_name}" z Pulpitu na żywo?\n\nUrządzenie zostanie wyrejestrowane z Zigbee2MQTT i ukryte z pulpitu, ale JEGO HISTORIA TELEMETRII ZOSTANIE ZACHOWANA. W razie ponownego połączenia wróci na pulpit z pełną historią.`)) {
      this.telemetry.deleteDevice(dev.ieee_address);
    }
  }

  restoreDevice(dev: Device): void {
    this.telemetry.restoreDevice(dev.ieee_address);
  }

  openPermanentDeleteModal(dev: Device): void {
    this.permanentTargetDevice.set(dev);
  }

  executePermanentDelete(): void {
    const target = this.permanentTargetDevice();
    if (!target) return;
    this.telemetry.permanentDeleteDevice(target.ieee_address).then(() => {
      this.permanentTargetDevice.set(null);
      this.selectedIeeeList.update((s) => {
        const copy = new Set(s);
        copy.delete(target.ieee_address);
        return copy;
      });
    });
  }

  openBatchPermanentDeleteModal(): void {
    if (this.selectedIeeeList().size === 0) return;
    this.showBatchPermanentModal.set(true);
  }

  executeBatchPermanentDelete(): void {
    const list = Array.from(this.selectedIeeeList());
    if (list.length === 0) return;
    this.telemetry.batchDeviceAction('permanent_delete', list).then(() => {
      this.showBatchPermanentModal.set(false);
      this.clearSelection();
    });
  }

  batchAction(action: 'soft_delete' | 'restore'): void {
    const list = Array.from(this.selectedIeeeList());
    if (list.length === 0) return;
    this.telemetry.batchDeviceAction(action, list).then(() => {
      this.clearSelection();
    });
  }

  testConnection(dev: Device): void {
    this.telemetry.testDeviceConnection(dev.ieee_address).then((res) => {
      alert(`Wynik testu połączenia dla ${dev.friendly_name}:\n\n${res.message}`);
    });
  }

  triggerAutoDiscover(): void {
    this.telemetry.autoDiscoverDongleMaxSubnet().then((res) => {
      alert(res.message);
    });
  }

  purgeAllDevices(): void {
    if (confirm('Czy na pewno chcesz usunąć wszystkie gniazdka/urządzenia z rejestru oraz skasować całą ich historię?')) {
      this.telemetry.purgeAllDevices().then(() => {
        this.clearSelection();
      });
    }
  }
}
