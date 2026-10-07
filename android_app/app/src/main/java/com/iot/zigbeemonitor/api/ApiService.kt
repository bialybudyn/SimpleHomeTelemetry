package com.iot.zigbeemonitor.api

import com.iot.zigbeemonitor.data.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    @GET("/api/devices")
    async suspend fun getDevices(): Response<DevicesResponse>

    @GET("/api/devices/{ieee}/history")
    async suspend fun getDeviceHistory(
        @Path("ieee") ieee: String,
        @Query("range") range: String = "24h"
    ): Response<HistoryResponse>

    @POST("/api/devices/{ieee}/rename")
    async suspend fun renameDevice(
        @Path("ieee") ieee: String,
        @Body body: RenameRequest
    ): Response<GenericResponse>

    @POST("/api/permit-join")
    async suspend fun triggerPermitJoin(
        @Body body: PermitJoinRequest = PermitJoinRequest(60)
    ): Response<GenericResponse>

    @GET("/api/system/status")
    async suspend fun getSystemStatus(): Response<Map<String, Any>>
}
