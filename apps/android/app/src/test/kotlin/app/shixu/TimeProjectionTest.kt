package app.shixu

import app.shixu.core.network.generated.models.DataFreshness
import app.shixu.core.ui.clockLabel
import app.shixu.core.ui.sourceLabel
import org.junit.Assert.*
import org.junit.Test
import java.time.OffsetDateTime
import java.time.ZoneId

class TimeProjectionTest {
    @Test fun projectsUtcTimestampToSelectedTimezoneAcrossDstBoundary() {
        val zone = ZoneId.of("America/New_York")
        assertEquals("01:00", clockLabel(OffsetDateTime.parse("2026-03-08T06:00:00Z"), zone))
        assertEquals("03:00", clockLabel(OffsetDateTime.parse("2026-03-08T07:00:00Z"), zone))
        assertEquals("15:00", clockLabel(OffsetDateTime.parse("2026-03-08T07:00:00Z"), ZoneId.of("Asia/Shanghai")))
    }
    @Test fun sourceBadgesDistinguishReplayBaselineAndUnavailable() {
        assertTrue(sourceLabel(DataFreshness.replay_demo).contains("回放测试源"))
        assertTrue(sourceLabel(DataFreshness.baseline_only).contains("基线估算"))
        assertFalse(sourceLabel(null).contains("实时"))
        assertFalse(sourceLabel(null).contains("基线估算"))
    }
}
