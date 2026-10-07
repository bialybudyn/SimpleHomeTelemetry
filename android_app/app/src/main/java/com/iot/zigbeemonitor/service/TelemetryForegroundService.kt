package com.iot.zigbeemonitor.service

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.gson.Gson
import com.iot.zigbeemonitor.data.WsTelemetryEvent
import com.iot.zigbeemonitor.notifications.SensorNotificationHelper
import okhttp3.*
import java.util.concurrent.TimeUnit

class TelemetryForegroundService : Service() {

    private val TAG = "TelemetryService"
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val gson = Gson()

    // Domyślne progi alarmowe (mogą być nadpisywane przez Intent lub SharedPreferences)
    private var tempMaxThreshold = 28.0
    private var tempMinThreshold = 15.0
    private var batteryMinThreshold = 15

    override fun onCreate() {
        super.onCreate()
        SensorNotificationHelper.createNotificationChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val serverHost = intent?.getStringExtra("SERVER_HOST") ?: "192.168.1.100:8000"
        tempMaxThreshold = intent?.getDoubleExtra("TEMP_MAX", 28.0) ?: 28.0
        tempMinThreshold = intent?.getDoubleExtra("TEMP_MIN", 15.0) ?: 15.0
        batteryMinThreshold = intent?.getIntExtra("BATTERY_MIN", 15) ?: 15

        startForegroundNotification(serverHost)
        connectWebSocket(serverHost)

        return START_STICKY
    }

    private fun startForegroundNotification(serverHost: String) {
        val notification = NotificationCompat.Builder(this, SensorNotificationHelper.CHANNEL_SERVICE_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Monitor Zigbee Sonoff Dongle-M")
            .setContentText("Połączono ze strumieniem telemetrii ($serverHost)")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

        startForeground(1001, notification)
    }

    private fun connectWebSocket(serverHost: String) {
        webSocket?.close(1000, "Reconnecting")

        val wsUrl = if (serverHost.startsWith("ws://") || serverHost.startsWith("wss://")) {
            if (serverHost.endsWith("/ws")) serverHost else "$serverHost/ws"
        } else {
            "ws://$serverHost/ws"
        }

        Log.d(TAG, "Łączenie z WebSocket: $wsUrl")
        val request = Request.Builder().url(wsUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket połączony pomyślnie z $wsUrl")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val event = gson.fromJson(text, WsTelemetryEvent::class.java)
                    if (event.type == "telemetry" && event.data != null) {
                        checkThresholdsAndNotify(event.deviceIeee ?: "Sensor", event.data.temperature, event.data.humidity, event.data.battery)
                    } else if (event.type == "device_joined") {
                        SensorNotificationHelper.showThresholdAlert(
                            this@TelemetryForegroundService,
                            (System.currentTimeMillis() % 10000).toInt(),
                            "Nowe urządzenie Zigbee",
                            "Wykryto nowe urządzenie: ${event.deviceIeee}"
                        )
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Błąd parsowania wiadomości: ${e.message}")
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "Błąd połączenia WebSocket: ${t.message}. Ponawianie za 10s...")
                // Automatyczne ponowienie za 10 sekund
                Thread.sleep(10000)
                connectWebSocket(serverHost)
            }
        })
    }

    private fun checkThresholdsAndNotify(deviceIeee: String, temp: Double, hum: Double, battery: Int?) {
        val idBase = deviceIeee.hashCode()

        // Alarm wysokiej temperatury
        if (temp > tempMaxThreshold) {
            SensorNotificationHelper.showThresholdAlert(
                this,
                idBase + 1,
                "ALARM: Wysoka temperatura!",
                "Czujnik $deviceIeee odnotował ${temp}°C (Przekroczono próg ${tempMaxThreshold}°C)"
            )
        }

        // Alarm niskiej temperatury
        if (temp < tempMinThreshold) {
            SensorNotificationHelper.showThresholdAlert(
                this,
                idBase + 2,
                "OSTRZEŻENIE: Niska temperatura!",
                "Czujnik $deviceIeee odnotował ${temp}°C (Poniżej progu ${tempMinThreshold}°C)"
            )
        }

        // Alarm niskiej baterii
        if (battery != null && battery <= batteryMinThreshold) {
            SensorNotificationHelper.showThresholdAlert(
                this,
                idBase + 3,
                "Bateria na wyczerpaniu",
                "Czujnik $deviceIeee ma tylko $battery% baterii. Wymień baterię CR2032/CR2450."
            )
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        webSocket?.close(1000, "Service stopped")
        client.dispatcher.executorService.shutdown()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
