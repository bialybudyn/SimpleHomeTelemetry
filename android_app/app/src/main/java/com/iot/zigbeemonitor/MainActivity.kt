package com.iot.zigbeemonitor

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.iot.zigbeemonitor.api.ApiService
import com.iot.zigbeemonitor.data.DeviceDto
import com.iot.zigbeemonitor.service.TelemetryForegroundService
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class MainActivity : ComponentActivity() {

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (!isGranted) {
            Toast.makeText(this, "Powiadomienia w czasie rzeczywistym wymagają uprawnień", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Android 13+ powiadomienia
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                background = Color(0xFF030712),
                surface = Color(0xFF0F172A),
                primary = Color(0xFF06B6D4),
                secondary = Color(0xFF3B82F6)
            )) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    ZigbeeDashboardScreen(
                        onStartService = { host ->
                            val intent = Intent(this, TelemetryForegroundService::class.java).apply {
                                putExtra("SERVER_HOST", host)
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                startForegroundService(intent)
                            } else {
                                startService(intent)
                            }
                            Toast.makeText(this, "Usługa powiadomień w tle uruchomiona", Toast.LENGTH_SHORT).show()
                        },
                        onStopService = {
                            stopService(Intent(this, TelemetryForegroundService::class.java))
                            Toast.makeText(this, "Zatrzymano usługę w tle", Toast.LENGTH_SHORT).show()
                        }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ZigbeeDashboardScreen(
    onStartService: (String) -> Unit,
    onStopService: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    var serverHost by remember { mutableStateOf("192.168.1.100:8000") }
    var showSettingsDialog by remember { mutableStateOf(false) }
    var devices by remember { mutableStateOf<List<DeviceDto>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var isPairingActive by remember { mutableStateOf(false) }
    var pairingCountdown by remember { mutableStateOf(60) }
    var isServiceRunning by remember { mutableStateOf(false) }

    fun buildRetrofit(host: String): ApiService {
        val baseUrl = if (host.startsWith("http://") || host.startsWith("https://")) host else "http://$host"
        val formatted = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return Retrofit.Builder()
            .baseUrl(formatted)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }

    fun loadDevices() {
        coroutineScope.launch {
            isLoading = true
            try {
                val api = buildRetrofit(serverHost)
                val response = api.getDevices()
                if (response.isSuccessful) {
                    devices = response.body()?.devices ?: emptyList()
                }
            } catch (e: Exception) {
                // błąd sieci
            } finally {
                isLoading = false
            }
        }
    }

    // Pobierz dane przy starcie
    LaunchedEffect(Unit) {
        loadDevices()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Zigbee Dongle-M",
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp,
                            color = Color.White
                        )
                        Text(
                            text = "Sonoff EFR32MG24 · ${devices.size} czujników",
                            fontSize = 11.sp,
                            color = Color(0xFF94A3B8)
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { loadDevices() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Odśwież", tint = Color(0xFF06B6D4))
                    }
                    IconButton(onClick = { showSettingsDialog = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "Ustawienia IP", tint = Color.White)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF0F172A))
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            // Pasek statusu i przycisk parowania
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Button(
                    onClick = {
                        coroutineScope.launch {
                            try {
                                val api = buildRetrofit(serverHost)
                                api.triggerPermitJoin()
                                isPairingActive = true
                                pairingCountdown = 60
                                while (pairingCountdown > 0) {
                                    delay(1000)
                                    pairingCountdown--
                                }
                                isPairingActive = false
                                loadDevices()
                            } catch (e: Exception) {
                                isPairingActive = false
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF06B6D4)),
                    shape = RoundedCornerShape(10.dp),
                    enabled = !isPairingActive
                ) {
                    Icon(Icons.Default.Sensors, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = if (isPairingActive) "Parowanie (${pairingCountdown}s)" else "Parowanie (60s)",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                // Przełącznik powiadomień w tle
                FilterChip(
                    selected = isServiceRunning,
                    onClick = {
                        isServiceRunning = !isServiceRunning
                        if (isServiceRunning) onStartService(serverHost) else onStopService()
                    },
                    label = {
                        Text(
                            text = if (isServiceRunning) "Powiadomienia: ON" else "Powiadomienia: OFF",
                            fontSize = 12.sp
                        )
                    },
                    leadingIcon = {
                        Icon(
                            if (isServiceRunning) Icons.Default.NotificationsActive else Icons.Default.NotificationsOff,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = if (isServiceRunning) Color(0xFF10B981) else Color(0xFF64748B)
                        )
                    }
                )
            }

            // Lista urządzeń
            if (devices.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.SensorsOff, contentDescription = null, tint = Color(0xFF475569), modifier = Modifier.size(54.dp))
                        Spacer(Modifier.height(10.dp))
                        Text("Brak połączonych czujników", color = Color(0xFF94A3B8), fontWeight = FontWeight.SemiBold)
                        Text("Sprawdź adres IP serwera lub uruchom parowanie", fontSize = 12.sp, color = Color(0xFF64748B))
                    }
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(devices) { dev ->
                        DeviceCard(dev)
                    }
                }
            }
        }
    }

    // Dialog ustawień adresu serwera
    if (showSettingsDialog) {
        var tempHost by remember { mutableStateOf(serverHost) }
        AlertDialog(
            onDismissRequest = { showSettingsDialog = false },
            title = { Text("Konfiguracja serwera IoT") },
            text = {
                Column {
                    Text("Podaj adres IP i port backendu (np. 192.168.1.50:8000):", fontSize = 13.sp, color = Color(0xFF94A3B8))
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = tempHost,
                        onValueChange = { tempHost = it },
                        singleLine = true,
                        label = { Text("Host serwera") }
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    serverHost = tempHost.trim()
                    showSettingsDialog = false
                    loadDevices()
                }) {
                    Text("Zapisz", color = Color(0xFF06B6D4))
                }
            },
            dismissButton = {
                TextButton(onClick = { showSettingsDialog = false }) {
                    Text("Anuluj")
                }
            }
        )
    }
}

@Composable
fun DeviceCard(dev: DeviceDto) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            // Nagłówek czujnika
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = dev.friendlyName ?: dev.ieeeAddress,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = Color.White
                    )
                    Text(
                        text = dev.ieeeAddress,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        color = Color(0xFF64748B)
                    )
                }

                // Wskaźnik baterii
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .background(Color(0xFF030712), RoundedCornerShape(8.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    val bat = dev.battery ?: 0
                    Icon(
                        if (bat > 30) Icons.Default.BatteryFull else Icons.Default.BatteryAlert,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = if (bat > 30) Color(0xFF10B981) else Color(0xFFF43F5E)
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        text = if (dev.battery != null) "${dev.battery}%" else "brak danych",
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = if (bat > 30) Color(0xFF10B981) else Color(0xFFF43F5E),
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // Temperatura i Wilgotność
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                // Temperatura
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .background(Color(0xFF030712), RoundedCornerShape(12.dp))
                        .padding(10.dp)
                ) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Thermostat, contentDescription = null, tint = Color(0xFF06B6D4), modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Temperatura", fontSize = 11.sp, color = Color(0xFF94A3B8))
                        }
                        Spacer(Modifier.height(4.dp))
                        Row(verticalAlignment = Alignment.Bottom) {
                            if (dev.lastTemperature != null) {
                                Text(
                                    text = String.format("%.1f", dev.lastTemperature),
                                    fontSize = 22.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color.White
                                )
                                Text(" °C", fontSize = 12.sp, color = Color(0xFF06B6D4), modifier = Modifier.padding(bottom = 2.dp))
                            } else {
                                Text(
                                    text = "brak danych",
                                    fontSize = 12.sp,
                                    fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color(0xFF64748B)
                                )
                            }
                        }
                    }
                }

                // Wilgotność
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .background(Color(0xFF030712), RoundedCornerShape(12.dp))
                        .padding(10.dp)
                ) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.WaterDrop, contentDescription = null, tint = Color(0xFF3B82F6), modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Wilgotność", fontSize = 11.sp, color = Color(0xFF94A3B8))
                        }
                        Spacer(Modifier.height(4.dp))
                        Row(verticalAlignment = Alignment.Bottom) {
                            if (dev.lastHumidity != null) {
                                Text(
                                    text = String.format("%.1f", dev.lastHumidity),
                                    fontSize = 22.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color.White
                                )
                                Text(" %", fontSize = 12.sp, color = Color(0xFF3B82F6), modifier = Modifier.padding(bottom = 2.dp))
                            } else {
                                Text(
                                    text = "brak danych",
                                    fontSize = 12.sp,
                                    fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                                    fontFamily = FontFamily.Monospace,
                                    color = Color(0xFF64748B)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
