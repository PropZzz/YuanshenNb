package app.shixu.core.network

import app.shixu.core.network.generated.models.ProblemDetail
import retrofit2.Response

object ProblemDetailParser {
    fun parse(response: Response<*>): ProblemDetail? {
        val raw = response.errorBody()?.string()?.takeIf { it.isNotBlank() } ?: return null
        return parseRaw(raw)
    }

    fun parseRaw(raw: String): ProblemDetail? =
        runCatching {
            ShixuJson.json.decodeFromString<ProblemDetail>(raw)
        }.getOrNull()
}
