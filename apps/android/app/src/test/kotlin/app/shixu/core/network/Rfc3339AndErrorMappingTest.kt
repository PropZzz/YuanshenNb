package app.shixu.core.network

import app.shixu.core.network.generated.models.ErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import java.time.LocalDate
import java.time.OffsetDateTime

class Rfc3339AndErrorMappingTest {

    @Test
    fun formatsMidnightOffsetDateTimeWithExplicitSeconds() {
        val retrofit = Retrofit.Builder()
            .baseUrl("http://localhost:8080/")
            .addConverterFactory(Rfc3339StringConverterFactory)
            .build()

        @Suppress("UNCHECKED_CAST")
        val odtConverter = Rfc3339StringConverterFactory.stringConverter(
            OffsetDateTime::class.java,
            emptyArray(),
            retrofit,
        ) as retrofit2.Converter<OffsetDateTime, String>

        val midnight = OffsetDateTime.parse("2026-11-19T00:00:00Z")
        assertEquals("2026-11-19T00:00:00Z", odtConverter.convert(midnight))

        @Suppress("UNCHECKED_CAST")
        val localDateConverter = Rfc3339StringConverterFactory.stringConverter(
            LocalDate::class.java,
            emptyArray(),
            retrofit,
        ) as retrofit2.Converter<LocalDate, String>
        assertEquals("2026-11-19", localDateConverter.convert(LocalDate.of(2026, 11, 19)))
    }

    @Test
    fun allStandardErrorCodesMapToNonBlankChineseMessages() {
        ErrorCode.entries.forEach { code ->
            val msg = ErrorMessageMapper.messageFor(code, null)
            assertTrue("ErrorCode $code must map to non-blank message", msg.isNotBlank())
        }
    }
}
