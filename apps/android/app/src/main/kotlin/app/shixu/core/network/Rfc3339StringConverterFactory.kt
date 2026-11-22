package app.shixu.core.network

import retrofit2.Converter
import retrofit2.Retrofit
import java.lang.reflect.Type
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/**
 * 强制使用 RFC 3339 / ISO-8601 格式序列化 Query/Path 参数，避免 OffsetDateTime.toString() 省略整分秒的 ":00" 导致服务端校验失败。
 */
object Rfc3339StringConverterFactory : Converter.Factory() {
    override fun stringConverter(
        type: Type,
        annotations: Array<out Annotation>,
        retrofit: Retrofit,
    ): Converter<*, String>? = when (type) {
        OffsetDateTime::class.java -> Converter<OffsetDateTime, String> { value ->
            DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(value)
        }
        LocalDate::class.java -> Converter<LocalDate, String> { value ->
            DateTimeFormatter.ISO_LOCAL_DATE.format(value)
        }
        else -> null
    }
}
