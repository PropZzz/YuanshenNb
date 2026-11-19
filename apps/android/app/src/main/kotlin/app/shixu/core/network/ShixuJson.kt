package app.shixu.core.network

import app.shixu.core.network.generated.infrastructure.Serializer
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json

object ShixuJson {
    @Volatile
    private var installed = false

    @OptIn(ExperimentalSerializationApi::class)
    fun install() {
        if (installed) return
        synchronized(this) {
            if (installed) return
            Serializer.kotlinxSerializationJsonConfiguration = {
                explicitNulls = false
                encodeDefaults = false
                ignoreUnknownKeys = true
                isLenient = true
            }
            installed = true
        }
    }

    val json: Json
        get() {
            install()
            return Serializer.kotlinxSerializationJson
        }
}
