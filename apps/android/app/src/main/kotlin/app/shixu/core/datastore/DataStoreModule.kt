package app.shixu.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import app.shixu.core.network.TokenStore
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Qualifier
import javax.inject.Singleton

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class TokenPreferencesDataStore

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class SyncPreferencesDataStore

@Module
@InstallIn(SingletonComponent::class)
abstract class DataStoreBindingsModule {

    @Binds
    @Singleton
    abstract fun bindTokenCipher(impl: AndroidKeystoreTokenCipher): TokenCipher

    @Binds
    @Singleton
    abstract fun bindTokenStore(impl: EncryptedTokenStore): TokenStore
}

@Module
@InstallIn(SingletonComponent::class)
object DataStoreModule {

    @Provides
    @Singleton
    @TokenPreferencesDataStore
    fun provideTokenPreferencesDataStore(
        @ApplicationContext context: Context,
    ): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            produceFile = { context.preferencesDataStoreFile("shixu_secure_tokens") },
        )

    @Provides
    @Singleton
    @SyncPreferencesDataStore
    fun provideSyncPreferencesDataStore(
        @ApplicationContext context: Context,
    ): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            produceFile = { context.preferencesDataStoreFile("shixu_sync_prefs") },
        )
}
