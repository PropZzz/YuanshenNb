package app.shixu.core.datastore

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.Base64

class EncryptedTokenStoreTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    @Test
    fun persistsEncryptedTokensAcrossStoreInstancesAndClearsCleanly() = runTest {
        val backingFile = tempFolder.newFile("tokens.preferences_pb")
        val cipher = FakeReversibleCipher()

        val scope1 = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val ds1 = PreferenceDataStoreFactory.create(scope = scope1, produceFile = { backingFile })
        val store1 = EncryptedTokenStore(ds1, cipher)
        store1.saveTokens("access-secret-jwt", "refresh-secret-token")

        assertEquals("access-secret-jwt", store1.accessToken())
        assertEquals("refresh-secret-token", store1.refreshToken())
        assertTrue(store1.hasSessionFlow.value)

        // 确认落盘文件中不含明文凭据
        val rawPersistedText = backingFile.readText(Charsets.ISO_8859_1)
        assertFalse(rawPersistedText.contains("access-secret-jwt"))
        assertFalse(rawPersistedText.contains("refresh-secret-token"))
        scope1.cancel()

        // 模拟进程重启：将落盘文件交由全新 DataStore 实例反序列化解密（避开同进程 activeFiles 互斥锁）
        val restartedFile = tempFolder.newFile("tokens_restarted.preferences_pb")
        backingFile.copyTo(restartedFile, overwrite = true)

        val scope2 = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val ds2 = PreferenceDataStoreFactory.create(scope = scope2, produceFile = { restartedFile })
        val store2 = EncryptedTokenStore(ds2, cipher)
        store2.warmUp()
        assertEquals("access-secret-jwt", store2.accessToken())
        assertEquals("refresh-secret-token", store2.refreshToken())
        assertTrue(store2.hasSessionFlow.value)

        store2.clear()
        assertNull(store2.accessToken())
        assertNull(store2.refreshToken())
        assertFalse(store2.hasSessionFlow.value)
        scope2.cancel()
    }

    @Test
    fun corruptedCiphertextDegradesGracefullyToNull() = runTest {
        val backingFile = tempFolder.newFile("corrupt.preferences_pb")
        val scope1 = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val ds = PreferenceDataStoreFactory.create(scope = scope1, produceFile = { backingFile })
        val writer = EncryptedTokenStore(ds, FakeReversibleCipher())
        writer.saveTokens("acc-1", "ref-1")
        scope1.cancel()

        val restartedFile = tempFolder.newFile("corrupt_restarted.preferences_pb")
        backingFile.copyTo(restartedFile, overwrite = true)

        // 换用会解密失败的损坏密钥器
        val failingCipher = object : TokenCipher {
            override fun encrypt(plainText: String): String = plainText
            override fun decrypt(cipherText: String): String? = null
        }
        val scope2 = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val dsRead = PreferenceDataStoreFactory.create(scope = scope2, produceFile = { restartedFile })
        val reader = EncryptedTokenStore(dsRead, failingCipher)
        reader.warmUp()

        assertNull(reader.accessToken())
        assertNull(reader.refreshToken())
        assertFalse(reader.hasSessionFlow.value)
        scope2.cancel()
    }

    private class FakeReversibleCipher : TokenCipher {
        override fun encrypt(plainText: String): String {
            val xored = plainText.toByteArray(Charsets.UTF_8).map { (it.toInt() xor 0x5A).toByte() }.toByteArray()
            return "ENC:" + Base64.getEncoder().encodeToString(xored)
        }

        override fun decrypt(cipherText: String): String? {
            if (!cipherText.startsWith("ENC:")) return null
            val bytes = Base64.getDecoder().decode(cipherText.removePrefix("ENC:"))
            val restored = bytes.map { (it.toInt() xor 0x5A).toByte() }.toByteArray()
            return String(restored, Charsets.UTF_8)
        }
    }
}
