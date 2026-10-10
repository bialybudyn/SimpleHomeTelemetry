/**
 * static/app.js - Klient Single Page Application do monitorowania telemetrii Zigbee Sonoff Dongle-M
 * Obsługuje REST API, WebSocket ze wznawianiem, kafelki czujników z pulsem na żywo oraz analitykę Chart.js.
 */

// Stan aplikacji
let devices = [];
let activeDeviceIeee = null;
let currentRange = "24h";
let chartInstance = null;
let ws = null;
let reconnectAttempts = 0;
let pairingTimer = null;
let pairingRemaining = 0;

// Elementy DOM
const wsStatusBadge = document.getElementById("wsStatusBadge");
const wsStatusDot = document.getElementById("wsStatusDot");
const wsStatusText = document.getElementById("wsStatusText");
const devicesGrid = document.getElementById("devicesGrid");
const emptyState = document.getElementById("emptyState");
const deviceCountLabel = document.getElementById("deviceCountLabel");
const lastGlobalUpdate = document.getElementById("lastGlobalUpdate");
const pairingBanner = document.getElementById("pairingBanner");
const pairingCountdown = document.getElementById("pairingCountdown");
const pairingBtn = document.getElementById("pairingBtn");
const analyticsModal = document.getElementById("analyticsModal");
const chartLoading = document.getElementById("chartLoading");

// Inicjalizacja po załadowaniu DOM
document.addEventListener("DOMContentLoaded", () => {
  initWebSocket();
  fetchDevices();

  // Okresowe odświeżanie etykiet względnych czasu ("2 minuty temu")
  setInterval(updateAllRelativeTimestamps, 30000);
});

/**
 * Inicjalizuje połączenie WebSocket z automatycznym wznawianiem
 */
function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  updateWsStatus("connecting", "Łączenie...");

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectAttempts = 0;
      updateWsStatus("connected", "Połączono (Live)");
      // Heartbeat ping co 30 sekund
      startPingInterval();
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleWebSocketMessage(payload);
      } catch (err) {
        console.error("Błąd parsowania wiadomości WebSocket:", err);
      }
    };

    ws.onclose = () => {
      updateWsStatus("disconnected", "Rozłączono (Wznawianie...)");
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      console.warn("Błąd WebSocket:", error);
      updateWsStatus("disconnected", "Błąd połączenia");
    };

  } catch (err) {
    updateWsStatus("disconnected", "Brak połączenia");
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  const delay = Math.min(10000, 1500 * Math.pow(1.5, reconnectAttempts++));
  setTimeout(initWebSocket, delay);
}

let pingIntervalId = null;
function startPingInterval() {
  if (pingIntervalId) clearInterval(pingIntervalId);
  pingIntervalId = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 25000);
}

function updateWsStatus(status, text) {
  if (!wsStatusDot || !wsStatusText) return;
  wsStatusText.textContent = text;
  if (status === "connected") {
    wsStatusDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50";
    wsStatusBadge.className = "flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60";
  } else if (status === "connecting") {
    wsStatusDot.className = "w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse";
    wsStatusBadge.className = "flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800";
  } else {
    wsStatusDot.className = "w-2.5 h-2.5 rounded-full bg-rose-500";
    wsStatusBadge.className = "flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800/60";
  }
}

/**
 * Obsługa komunikatów przychodzących z backendu przez WebSocket
 */
function handleWebSocketMessage(msg) {
  if (msg.type === "telemetry") {
    const { device_ieee, data } = msg;
    handleIncomingTelemetry(device_ieee, data);
  } else if (msg.type === "battery_alert") {
    showBatteryNotification(msg);
  } else if (msg.type === "permit_join") {
    startPairingCountdown(msg.duration || 60);
  } else if (msg.type === "device_renamed") {
    updateDeviceNameLocal(msg.device_ieee, msg.friendly_name);
  } else if (msg.type === "device_joined") {
    fetchDevices();
  }
}

function showBatteryNotification(alert) {
  const banner = document.getElementById("batteryAlertBanner");
  const content = document.getElementById("batteryAlertContent");
  if (banner && content) {
    const devName = alert.friendly_name || alert.device_ieee;
    content.innerHTML = `<strong>⚠️ Ostrzeżenie baterii:</strong> Czujnik <strong>${escapeHtml(devName)}</strong> (${escapeHtml(alert.device_ieee)}) ma tylko <strong>${alert.battery}%</strong> baterii! Wymień baterię.`;
    banner.classList.remove("hidden");
  }
}

function dismissBatteryBanner() {
  const banner = document.getElementById("batteryAlertBanner");
  if (banner) banner.classList.add("hidden");
}

/**
 * Aktualizacja kafelka urządzenia przy nowym pomiarze telemetrii
 */
function handleIncomingTelemetry(ieee, data) {
  const nowStr = new Date().toLocaleTimeString();
  if (lastGlobalUpdate) lastGlobalUpdate.textContent = nowStr;

  let device = devices.find(d => d.ieee_address === ieee);
  if (!device) {
    // Nowe urządzenie odebrane w locie - odśwież listę
    fetchDevices();
    return;
  }

  // Zaktualizuj stan w pamięci
  device.last_temperature = data.temperature;
  device.last_humidity = data.humidity;
  if (data.battery !== undefined && data.battery !== null) device.battery = data.battery;
  if (data.linkquality !== undefined && data.linkquality !== null) device.linkquality = data.linkquality;
  device.last_seen = data.timestamp || new Date().toISOString();

  // Zaktualizuj DOM kafelka
  renderDeviceCard(device, true);

  // Jeśli otwarty jest modal dla tego urządzenia, odśwież wykres
  if (activeDeviceIeee === ieee && chartInstance) {
    appendDataToChart(data);
  }
}

/**
 * Pobiera listę urządzeń z REST API
 */
async function fetchDevices() {
  try {
    const res = await fetch("/api/devices");
    if (!res.ok) throw new Error("Błąd pobierania urządzeń");
    const json = await res.json();
    devices = json.devices || [];

    if (deviceCountLabel) deviceCountLabel.textContent = devices.length;

    renderDevicesGrid();
  } catch (err) {
    console.error("fetchDevices:", err);
  }
}

/**
 * Renderuje całą siatkę czujników
 */
function renderDevicesGrid() {
  if (!devicesGrid) return;
  devicesGrid.innerHTML = "";

  if (devices.length === 0) {
    emptyState.classList.remove("hidden");
    devicesGrid.classList.add("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  devicesGrid.classList.remove("hidden");

  devices.forEach(dev => {
    const card = createDeviceCardElement(dev);
    devicesGrid.appendChild(card);
  });
}

/**
 * Tworzy element DOM karty czujnika
 */
function createDeviceCardElement(dev) {
  const card = document.createElement("div");
  card.id = `card-${escapeId(dev.ieee_address)}`;
  card.className = "group relative bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 transition-all duration-200 cursor-pointer shadow-md hover:shadow-xl hover:shadow-cyan-950/20";
  card.onclick = (e) => {
    // Nie otwieraj modala jeśli kliknięto przycisk edycji nazwy
    if (e.target.closest(".edit-name-btn")) return;
    openAnalyticsModal(dev.ieee_address);
  };

  card.innerHTML = getDeviceCardHtml(dev);
  return card;
}

/**
 * Aktualizuje istniejący kafelek w DOM (z animacją pulsu akcentem)
 */
function renderDeviceCard(dev, triggerPulse = false) {
  const cardId = `card-${escapeId(dev.ieee_address)}`;
  let card = document.getElementById(cardId);
  if (!card) {
    renderDevicesGrid();
    return;
  }

  card.innerHTML = getDeviceCardHtml(dev);

  if (triggerPulse) {
    card.classList.remove("pulse-update");
    // Wymuszenie reflow dla restartu animacji CSS
    void card.offsetWidth;
    card.classList.add("pulse-update");
  }
}

/**
 * Generuje czysty HTML kafelka czujnika zgodnie z zasadami interfejsu IoT
 */
function getDeviceCardHtml(dev) {
  const hasTemp = dev.last_temperature !== null && dev.last_temperature !== undefined;
  const tempHtml = hasTemp
    ? `<span class="text-2xl font-bold font-mono text-white tabular-nums">${dev.last_temperature.toFixed(1)}</span><span class="text-xs font-mono text-cyan-400 ml-1">°C</span>`
    : `<span class="text-xs font-mono text-slate-500 italic">brak danych</span>`;

  const hasHum = dev.last_humidity !== null && dev.last_humidity !== undefined;
  const humHtml = hasHum
    ? `<span class="text-2xl font-bold font-mono text-white tabular-nums">${dev.last_humidity.toFixed(1)}</span><span class="text-xs font-mono text-blue-400 ml-1">%</span>`
    : `<span class="text-xs font-mono text-slate-500 italic">brak danych</span>`;

  const battery = dev.battery !== null && dev.battery !== undefined ? dev.battery : null;
  const timeRelative = dev.last_seen ? formatRelativeTime(dev.last_seen) : "brak danych";

  // Ikona baterii i kolor
  let batIcon = "battery_unknown";
  let batColor = "text-slate-500";
  if (battery !== null) {
    if (battery > 75) { batIcon = "battery_full"; batColor = "text-emerald-400"; }
    else if (battery > 40) { batIcon = "battery_5_bar"; batColor = "text-emerald-300"; }
    else if (battery > 20) { batIcon = "battery_3_bar"; batColor = "text-amber-400"; }
    else { batIcon = "battery_alert"; batColor = "text-rose-400 animate-pulse"; }
  }

  // Sygnał LQI (Link Quality)
  const hasLqi = dev.linkquality !== null && dev.linkquality !== undefined;
  const lqi = hasLqi ? dev.linkquality : null;
  let lqiBars = 1;
  if (lqi && lqi > 120) lqiBars = 4;
  else if (lqi && lqi > 70) lqiBars = 3;
  else if (lqi && lqi > 30) lqiBars = 2;

  return `
    <!-- Nagłówek karty: Nazwa i IEEE -->
    <div class="flex items-start justify-between gap-3 mb-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <h3 class="text-sm font-bold text-white truncate">${escapeHtml(dev.friendly_name || dev.ieee_address)}</h3>
          <button class="edit-name-btn text-slate-500 hover:text-cyan-400 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity" 
                  onclick="event.stopPropagation(); promptRenameDeviceFromCard('${dev.ieee_address}', '${escapeHtml(dev.friendly_name || '')}')" 
                  title="Zmień nazwę">
            <span class="material-icons text-xs">edit</span>
          </button>
        </div>
        <div class="text-[11px] font-mono text-slate-400 truncate mt-0.5">${dev.ieee_address}</div>
      </div>

      <!-- Wskaźnik zasilania (Bateria) -->
      <div class="flex items-center gap-1 text-xs font-mono shrink-0 px-2 py-1 rounded-md bg-slate-950/70 border border-slate-800" title="${battery !== null ? 'Bateria: ' + battery + '%' : 'Brak danych o baterii'}">
        <span class="material-icons text-sm ${batColor}">${batIcon}</span>
        <span class="${batColor} tabular-nums font-semibold">${battery !== null ? battery + '%' : 'brak danych'}</span>
      </div>
    </div>

    <!-- Pomiary główne: Duża temperatura i wilgotność -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      
      <!-- Kafelek Temperatura -->
      <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
        <div class="flex items-center gap-1 text-[11px] font-medium text-slate-400 mb-1">
          <span class="material-icons text-cyan-400 text-xs">thermostat</span>
          <span>Temperatura</span>
        </div>
        <div class="flex items-baseline">
          ${tempHtml}
        </div>
      </div>

      <!-- Kafelek Wilgotność -->
      <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
        <div class="flex items-center gap-1 text-[11px] font-medium text-slate-400 mb-1">
          <span class="material-icons text-blue-400 text-xs">water_drop</span>
          <span>Wilgotność</span>
        </div>
        <div class="flex items-baseline">
          ${humHtml}
        </div>
      </div>

    </div>

    <!-- Stopka kafelka: Znacznik czasu oraz jakość łącza (LQI) -->
    <div class="flex items-center justify-between text-[11px] text-slate-400 pt-3 border-t border-slate-800/60">
      <div class="flex items-center gap-1.5">
        <span class="material-icons text-xs text-slate-500">schedule</span>
        <span class="time-relative" data-time="${dev.last_seen || ''}">${timeRelative}</span>
      </div>

      <div class="flex items-center gap-1" title="${hasLqi ? 'Jakość połączenia Zigbee (LQI: ' + lqi + ')' : 'Brak danych LQI'}">
        <span class="material-icons text-xs ${hasLqi && lqiBars >= 3 ? 'text-emerald-400' : (hasLqi ? 'text-amber-400' : 'text-slate-600')}">signal_cellular_alt</span>
        <span class="font-mono text-[10px] text-slate-400">${hasLqi ? lqi + ' LQI' : 'brak danych'}</span>
      </div>
    </div>
  `;
}

/**
 * Wywołanie trybu parowania (permit_join) z odliczaniem 60 sekund
 */
async function triggerPairing() {
  try {
    pairingBtn.disabled = true;
    const res = await fetch("/api/permit-join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration: 60 })
    });
    if (!res.ok) throw new Error("Błąd permit-join");
    startPairingCountdown(60);
  } catch (err) {
    console.error("triggerPairing:", err);
    alert("Nie udało się uruchomić trybu parowania. Sprawdź status backendu.");
    pairingBtn.disabled = false;
  }
}

function startPairingCountdown(seconds) {
  if (pairingTimer) clearInterval(pairingTimer);
  pairingRemaining = seconds;

  pairingBanner.classList.remove("hidden");
  pairingCountdown.textContent = `${pairingRemaining}s`;
  pairingBtn.disabled = true;
  document.getElementById("pairingBtnText").textContent = `Pairing (${pairingRemaining}s)`;

  pairingTimer = setInterval(() => {
    pairingRemaining--;
    if (pairingRemaining <= 0) {
      clearInterval(pairingTimer);
      pairingBanner.classList.add("hidden");
      pairingBtn.disabled = false;
      document.getElementById("pairingBtnText").textContent = "Pairing";
      fetchDevices();
    } else {
      pairingCountdown.textContent = `${pairingRemaining}s`;
      document.getElementById("pairingBtnText").textContent = `Pairing (${pairingRemaining}s)`;
    }
  }, 1000);
}

/**
 * Obsługa modala analitycznego i Chart.js
 */
async function openAnalyticsModal(deviceIeee) {
  activeDeviceIeee = deviceIeee;
  const dev = devices.find(d => d.ieee_address === deviceIeee);
  if (!dev) return;

  document.getElementById("modalDeviceName").textContent = dev.friendly_name || dev.ieee_address;
  document.getElementById("modalDeviceIeee").textContent = `IEEE: ${dev.ieee_address} · Model: ${dev.model || 'Zigbee'}`;

  analyticsModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  await loadDeviceHistory(currentRange);
}

function closeAnalyticsModal() {
  analyticsModal.classList.add("hidden");
  document.body.style.overflow = "auto";
  activeDeviceIeee = null;
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

// Zamykanie modala klawiszem Escape lub kliknięciem tła
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !analyticsModal.classList.contains("hidden")) {
    closeAnalyticsModal();
  }
});

analyticsModal.addEventListener("click", (e) => {
  if (e.target === analyticsModal) {
    closeAnalyticsModal();
  }
});

/**
 * Ładowanie historii i renderowanie wykresu dla wybranego zakresu
 */
async function loadDeviceHistory(range) {
  currentRange = range;
  updateRangeButtonStyles(range);

  if (!activeDeviceIeee) return;
  if (chartLoading) chartLoading.classList.remove("hidden");

  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(activeDeviceIeee)}/history?range=${range}`);
    if (!res.ok) throw new Error("Błąd pobierania historii");
    const json = await res.json();

    updateStatsSummary(json.stats, json.count);
    renderChart(json.history);
  } catch (err) {
    console.error("loadDeviceHistory:", err);
  } finally {
    if (chartLoading) chartLoading.classList.add("hidden");
  }
}

function updateRangeButtonStyles(activeRange) {
  const container = document.getElementById("rangeButtons");
  if (!container) return;
  const buttons = container.querySelectorAll("button");
  buttons.forEach(btn => {
    if (btn.dataset.range === activeRange) {
      btn.className = "px-2.5 py-1 rounded-md bg-cyan-600 text-white font-semibold shadow-sm";
    } else {
      btn.className = "px-2.5 py-1 rounded-md text-slate-400 hover:text-white transition-colors";
    }
  });
}

function updateStatsSummary(stats, count) {
  document.getElementById("statAvgTemp").textContent = stats && stats.avg_temp ? `${stats.avg_temp} °C` : "—";
  document.getElementById("statMinTemp").textContent = stats && stats.min_temp ? `${stats.min_temp}°` : "—";
  document.getElementById("statMaxTemp").textContent = stats && stats.max_temp ? `${stats.max_temp}°` : "—";

  document.getElementById("statAvgHum").textContent = stats && stats.avg_hum ? `${stats.avg_hum} %` : "—";
  document.getElementById("statMinHum").textContent = stats && stats.min_hum ? `${stats.min_hum}%` : "—";
  document.getElementById("statMaxHum").textContent = stats && stats.max_hum ? `${stats.max_hum}%` : "—";

  const dev = devices.find(d => d.ieee_address === activeDeviceIeee);
  document.getElementById("statBattery").textContent = dev && dev.battery !== null ? `${dev.battery} %` : "—";
  document.getElementById("statSampleCount").textContent = count || 0;
}

/**
 * Renderuje podwójny wykres liniowy w Chart.js
 */
function renderChart(history) {
  const canvas = document.getElementById("telemetryChart");
  if (!canvas) return;

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  // Formatowanie etykiet czasowych
  const labels = history.map(item => {
    const d = new Date(item.timestamp);
    if (isNaN(d.getTime())) return item.timestamp;
    if (currentRange === "6h" || currentRange === "24h") {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return `${d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });

  const tempData = history.map(item => item.temperature);
  const humData = history.map(item => item.humidity);

  const ctx = canvas.getContext("2d");

  // Gradienty dla linii
  const tempGradient = ctx.createLinearGradient(0, 0, 0, 300);
  tempGradient.addColorStop(0, "rgba(6, 182, 212, 0.25)");
  tempGradient.addColorStop(1, "rgba(6, 182, 212, 0.0)");

  const humGradient = ctx.createLinearGradient(0, 0, 0, 300);
  humGradient.addColorStop(0, "rgba(59, 130, 246, 0.2)");
  humGradient.addColorStop(1, "rgba(59, 130, 246, 0.0)");

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Temperatura (°C)",
          data: tempData,
          borderColor: "#06b6d4",
          backgroundColor: tempGradient,
          borderWidth: 2.2,
          pointRadius: history.length > 80 ? 0 : 2.5,
          pointHoverRadius: 5,
          pointBackgroundColor: "#06b6d4",
          fill: true,
          tension: 0.35,
          yAxisID: "yTemp",
        },
        {
          label: "Wilgotność (%)",
          data: humData,
          borderColor: "#3b82f6",
          backgroundColor: humGradient,
          borderWidth: 2,
          pointRadius: history.length > 80 ? 0 : 2.5,
          pointHoverRadius: 5,
          pointBackgroundColor: "#3b82f6",
          fill: true,
          tension: 0.35,
          yAxisID: "yHum",
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            color: "#94a3b8",
            font: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
            usePointStyle: true,
            boxWidth: 8
          }
        },
        tooltip: {
          backgroundColor: "#020617",
          titleColor: "#e2e8f0",
          bodyColor: "#f8fafc",
          borderColor: "#334155",
          borderWidth: 1,
          padding: 10,
          bodyFont: { family: "'JetBrains Mono', monospace" }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(51, 65, 85, 0.25)" },
          ticks: {
            color: "#64748b",
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          }
        },
        yTemp: {
          type: "linear",
          position: "left",
          grid: { color: "rgba(51, 65, 85, 0.25)" },
          ticks: {
            color: "#06b6d4",
            font: { family: "'JetBrains Mono', monospace", size: 11 },
            callback: (v) => `${v}°C`
          }
        },
        yHum: {
          type: "linear",
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: {
            color: "#3b82f6",
            font: { family: "'JetBrains Mono', monospace", size: 11 },
            callback: (v) => `${v}%`
          },
          min: 0,
          max: 100
        }
      }
    }
  });
}

function appendDataToChart(newPoint) {
  if (!chartInstance) return;
  const d = new Date(newPoint.timestamp);
  const timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  chartInstance.data.labels.push(timeLabel);
  chartInstance.data.datasets[0].data.push(newPoint.temperature);
  chartInstance.data.datasets[1].data.push(newPoint.humidity);

  // Ogranicz liczbę punktów na żywo, by nie zamulić przeglądarki
  if (chartInstance.data.labels.length > 300) {
    chartInstance.data.labels.shift();
    chartInstance.data.datasets[0].data.shift();
    chartInstance.data.datasets[1].data.shift();
  }

  chartInstance.update('none');
}

/**
 * Zmiana przyjaznej nazwy czujnika
 */
async function promptRenameDevice() {
  if (!activeDeviceIeee) return;
  const dev = devices.find(d => d.ieee_address === activeDeviceIeee);
  const oldName = dev ? dev.friendly_name : "";
  const newName = prompt("Wprowadź nową przyjazną nazwę dla tego czujnika:", oldName);

  if (newName !== null && newName.trim() !== "") {
    await renameDeviceApi(activeDeviceIeee, newName.trim());
  }
}

async function promptRenameDeviceFromCard(ieee, currentName) {
  const newName = prompt("Wprowadź nową przyjazną nazwę dla tego czujnika:", currentName);
  if (newName !== null && newName.trim() !== "") {
    await renameDeviceApi(ieee, newName.trim());
  }
}

async function renameDeviceApi(ieee, newName) {
  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(ieee)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendly_name: newName })
    });
    if (!res.ok) throw new Error("Błąd zmiany nazwy");
    updateDeviceNameLocal(ieee, newName);
  } catch (err) {
    console.error("renameDeviceApi:", err);
    alert("Nie udało się zaktualizować nazwy.");
  }
}

function updateDeviceNameLocal(ieee, newName) {
  const dev = devices.find(d => d.ieee_address === ieee);
  if (dev) {
    dev.friendly_name = newName;
    renderDeviceCard(dev);
  }
  if (activeDeviceIeee === ieee) {
    document.getElementById("modalDeviceName").textContent = newName;
  }
}

/**
 * Formatowanie względnego czasu ("2 minuty temu")
 */
function formatRelativeTime(dateString) {
  if (!dateString) return "brak danych";
  const date = new Date(dateString.includes("Z") || dateString.includes("T") ? dateString : dateString.replace(" ", "T") + "Z");
  if (isNaN(date.getTime())) return dateString;

  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 15) return "przed chwilą";
  if (diffSec < 60) return `${diffSec} sek temu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return "1 minutę temu";
  if (diffMin < 5) return `${diffMin} minuty temu`;
  if (diffMin < 60) return `${diffMin} minut temu`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours === 1) return "1 godzinę temu";
  if (diffHours < 5) return `${diffHours} godziny temu`;
  if (diffHours < 24) return `${diffHours} godzin temu`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} dni temu`;
}

function updateAllRelativeTimestamps() {
  const elements = document.querySelectorAll(".time-relative");
  elements.forEach(el => {
    const timeStr = el.getAttribute("data-time");
    if (timeStr) {
      el.textContent = formatRelativeTime(timeStr);
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeId(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "_");
}
