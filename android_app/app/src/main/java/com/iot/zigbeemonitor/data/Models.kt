package com.iot.zigbeemonitor.data

import com.google.gson.annotations.SerializedName

data class DeviceDto(
    @SerializedName("ieee_address") val ieeeAddress: String,
    @SerializedName("friendly_name") val friendlyName: String?,
    @SerializedName("model") val model: String?,
    @SerializedName("last_seen") val lastSeen: String?,
    @SerializedName("battery") val battery: Int?,
    @SerializedName("last_temperature") val lastTemperature: Double?,
    @SerializedName("last_humidity") val lastHumidity: Double?,
    @SerializedName("linkquality") val linkquality: Int?
)

data class DevicesResponse(
    @SerializedName("devices") val devices: List<DeviceDto>
)

data class TelemetryRecord(
    @SerializedName("id") val id: Long?,
    @SerializedName("device_ieee") val deviceIeee: String,
    @SerializedName("temperature") val temperature: Double,
    @SerializedName("humidity") val humidity: Double,
    @SerializedName("battery") val battery: Int?,
    @SerializedName("linkquality") val linkquality: Int?,
    @SerializedName("timestamp") val timestamp: String
)

data class StatsDto(
    @SerializedName("count") val count: Int?,
    @SerializedName("min_temp") val minTemp: Double?,
    @SerializedName("max_temp") val maxTemp: Double?,
    @SerializedName("avg_temp") val avgTemp: Double?,
    @SerializedName("min_hum") val minHum: Double?,
    @SerializedName("max_hum") val maxHum: Double?,
    @SerializedName("avg_hum") val avgHum: Double?
)

data class HistoryResponse(
    @SerializedName("device_ieee") val deviceIeee: String,
    @SerializedName("range") val range: String,
    @SerializedName("count") val count: Int,
    @SerializedName("stats") val stats: StatsDto?,
    @SerializedName("history") val history: List<TelemetryRecord>
)

data class RenameRequest(
    @SerializedName("friendly_name") val friendlyName: String
)

data class PermitJoinRequest(
    @SerializedName("duration") val duration: Int = 60
)

data class GenericResponse(
    @SerializedName("status") val status: String
)

// Komunikaty WebSocket
data class WsTelemetryEvent(
    @SerializedName("type") val type: String,
    @SerializedName("device_ieee") val deviceIeee: String?,
    @SerializedName("data") val data: TelemetryRecord?,
    @SerializedName("friendly_name") val friendlyName: String?,
    @SerializedName("duration") val duration: Int?
)
