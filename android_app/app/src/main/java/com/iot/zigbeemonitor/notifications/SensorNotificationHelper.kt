package com.iot.zigbeemonitor.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.iot.zigbeemonitor.MainActivity

object SensorNotificationHelper {

    const val CHANNEL_ALERTS_ID = "zigbee_telemetry_alerts"
    const val CHANNEL_SERVICE_ID = "zigbee_foreground_service"

    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Kanał dla alarmów krytycznych (temperatura, bateria)
            val alertChannel = NotificationChannel(
                CHANNEL_ALERTS_ID,
                "Alarmy i Ostrzeżenia Telemetrii",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Powiadomienia o przekroczeniu progów temperatury, wilgotności lub niskim stanie baterii"
                enableVibration(true)
            }

            // Kanał dla serwisu działającego w tle
            val serviceChannel = NotificationChannel(
                CHANNEL_SERVICE_ID,
                "Monitorowanie w tle (WebSocket)",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Utrzymuje aktywne połączenie z serwerem Sonoff Dongle-M"
            }

            notificationManager.createNotificationChannel(alertChannel)
            notificationManager.createNotificationChannel(serviceChannel)
        }
    }

    fun showThresholdAlert(
        context: Context,
        notificationId: Int,
        title: String,
        message: String
    ) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS_ID)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(notificationId, notification)
    }
}
