package app.shixu.core.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import app.shixu.core.database.PendingBiometricEntity
import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.health.BiometricFlushResult
import app.shixu.core.health.BiometricUploadQueue
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.models.EnergyTodayResponse
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class BleDiscoveredDevice(
    val address: String,
    val name: String,
    val rssi: Int,
)

sealed interface BleConnectionState {
    data class Disconnected(val message: String? = null) : BleConnectionState
    data class Scanning(val devices: List<BleDiscoveredDevice>) : BleConnectionState
    data class Connecting(val device: BleDiscoveredDevice) : BleConnectionState
    data class Streaming(
        val device: BleDiscoveredDevice,
        val hrBpm: Int?,
        val latestRmssdMs: Double?,
        val validRrCount: Int,
        val rejectedRrCount: Int,
        val uploadedWindowsCount: Int,
        val lastPacketAtEpochMs: Long?,
    ) : BleConnectionState
}

/**
 * 原生 BLE GATT (0x180D / 0x2A37) 实时心率与 RR 间期采集管道，支持自动断线指数退避重连及 60s 窗口批量补传。
 */
@Singleton
class BleHeartRateManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val uploadQueue: BiometricUploadQueue,
    private val syncPreferencesStore: SyncPreferencesStore,
    private val clock: () -> Instant,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _state = MutableStateFlow<BleConnectionState>(BleConnectionState.Disconnected())
    val state: StateFlow<BleConnectionState> = _state.asStateFlow()

    private val _latestEnergyFromBle = MutableSharedFlow<EnergyTodayResponse>(extraBufferCapacity = 4)
    val latestEnergyFromBle: SharedFlow<EnergyTodayResponse> = _latestEnergyFromBle.asSharedFlow()

    private val discoveredMap = LinkedHashMap<String, Pair<BluetoothDevice, BleDiscoveredDevice>>()
    private var scanTimeoutJob: Job? = null
    private var reconnectJob: Job? = null
    private var activeScanCallback: ScanCallback? = null
    private var activeGatt: BluetoothGatt? = null
    private var activeDevice: BleDiscoveredDevice? = null
    private var aggregator: RrWindowAggregator? = null
    private var uploadedWindowsCount = 0
    private var reconnectAttempt = 0

    @Volatile
    private var userInitiatedDisconnect = false

    fun requiredRuntimePermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    fun hasPermissions(): Boolean = requiredRuntimePermissions().all { perm ->
        ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED
    }

    fun isBluetoothEnabled(): Boolean {
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
        return adapter?.isEnabled == true
    }

    @SuppressLint("MissingPermission")
    fun startScan() {
        if (!hasPermissions()) {
            _state.value = BleConnectionState.Disconnected("请先授予蓝牙扫描与连接权限")
            return
        }
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            _state.value = BleConnectionState.Disconnected("系统蓝牙未开启，请开启蓝牙或使用 Health Connect 同步")
            return
        }
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            _state.value = BleConnectionState.Disconnected("当前设备不支持 BLE 低功耗扫描")
            return
        }

        stopScanInternal(resetState = false)
        discoveredMap.clear()
        _state.value = BleConnectionState.Scanning(emptyList())

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(HEART_RATE_SERVICE_UUID))
            .build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device ?: return
                val address = device.address ?: return
                val label = safeDeviceName(device) ?: "心率设备 (${address.takeLast(5)})"
                val item = BleDiscoveredDevice(address = address, name = label, rssi = result.rssi)
                synchronized(discoveredMap) {
                    discoveredMap[address] = device to item
                    _state.value = BleConnectionState.Scanning(discoveredMap.values.map { it.second })
                }
            }

            override fun onScanFailed(errorCode: Int) {
                _state.value = BleConnectionState.Disconnected("BLE 扫描失败 (code=$errorCode)，请重试或改用 Health Connect")
            }
        }

        activeScanCallback = callback
        runCatching {
            scanner.startScan(listOf(filter), settings, callback)
        }.onFailure { err ->
            activeScanCallback = null
            _state.value = BleConnectionState.Disconnected("无法启动蓝牙扫描：${err.localizedMessage ?: "未知错误"}")
            return
        }

        scanTimeoutJob?.cancel()
        scanTimeoutJob = scope.launch {
            delay(SCAN_DURATION_MS)
            stopScanInternal(resetState = true)
        }
    }

    fun stopScan() {
        stopScanInternal(resetState = true)
    }

    @SuppressLint("MissingPermission")
    fun connectTo(address: String) {
        if (!hasPermissions()) {
            _state.value = BleConnectionState.Disconnected("缺少蓝牙连接权限")
            return
        }
        val entry = synchronized(discoveredMap) { discoveredMap[address] }
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
        val btDevice = entry?.first ?: runCatching { adapter?.getRemoteDevice(address) }.getOrNull()
        if (btDevice == null) {
            _state.value = BleConnectionState.Disconnected("未找到目标蓝牙设备，请重新扫描")
            return
        }
        val deviceInfo = entry?.second ?: BleDiscoveredDevice(
            address = address,
            name = safeDeviceName(btDevice) ?: "心率带",
            rssi = 0,
        )

        stopScanInternal(resetState = false)
        reconnectJob?.cancel()
        closeGattInternal()

        userInitiatedDisconnect = false
        reconnectAttempt = 0
        activeDevice = deviceInfo
        uploadedWindowsCount = 0
        aggregator = RrWindowAggregator(
            deviceIdentifier = deviceInfo.address,
            deviceName = deviceInfo.name,
            nowMsProvider = { clock().toEpochMilli() },
        )
        _state.value = BleConnectionState.Connecting(deviceInfo)
        scope.launch {
            syncPreferencesStore.updateLastBleDevice(deviceInfo.address, deviceInfo.name)
        }
        activeGatt = btDevice.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    @SuppressLint("MissingPermission")
    fun disconnect() {
        userInitiatedDisconnect = true
        reconnectJob?.cancel()
        stopScanInternal(resetState = false)
        val remaining = aggregator?.flushCurrentWindow().orEmpty()
        closeGattInternal()
        activeDevice = null
        _state.value = BleConnectionState.Disconnected("已主动断开 BLE 心率直连")
        if (remaining.isNotEmpty()) {
            scope.launch { enqueueAndFlush(remaining) }
        }
    }

    @SuppressLint("MissingPermission")
    private fun stopScanInternal(resetState: Boolean) {
        scanTimeoutJob?.cancel()
        scanTimeoutJob = null
        val cb = activeScanCallback ?: return
        activeScanCallback = null
        val scanner = context.getSystemService(BluetoothManager::class.java)?.adapter?.bluetoothLeScanner
        if (hasPermissions() && scanner != null) {
            runCatching { scanner.stopScan(cb) }
        }
        if (resetState && _state.value is BleConnectionState.Scanning) {
            val foundCount = synchronized(discoveredMap) { discoveredMap.size }
            _state.value = BleConnectionState.Disconnected(
                if (foundCount == 0) "未发现支持 0x180D 标准心率服务的设备" else null,
            )
        }
    }

    @SuppressLint("MissingPermission")
    private fun closeGattInternal() {
        val gatt = activeGatt ?: return
        activeGatt = null
        if (hasPermissions()) {
            runCatching { gatt.disconnect() }
            runCatching { gatt.close() }
        }
    }

    @SuppressLint("MissingPermission")
    private fun safeDeviceName(device: BluetoothDevice): String? =
        if (hasPermissions()) runCatching { device.name }.getOrNull() else null

    private val gattCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                reconnectAttempt = 0
                if (hasPermissions()) {
                    gatt.discoverServices()
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                runCatching { gatt.close() }
                if (activeGatt === gatt) {
                    activeGatt = null
                }
                val remaining = aggregator?.flushCurrentWindow().orEmpty()
                if (remaining.isNotEmpty()) {
                    scope.launch { enqueueAndFlush(remaining) }
                }
                if (!userInitiatedDisconnect) {
                    scheduleReconnectOrFallback(status)
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                _state.value = BleConnectionState.Disconnected("GATT 服务发现失败 (status=$status)")
                return
            }
            val hrChar = gatt.getService(HEART_RATE_SERVICE_UUID)
                ?.getCharacteristic(HEART_RATE_MEASUREMENT_CHAR_UUID)
            if (hrChar == null) {
                _state.value = BleConnectionState.Disconnected("设备未提供 0x2A37 心率特征")
                return
            }
            if (!hasPermissions()) return

            gatt.setCharacteristicNotification(hrChar, true)
            val cccd = hrChar.getDescriptor(CCCD_UUID)
            if (cccd != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                } else {
                    @Suppress("DEPRECATION")
                    cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    @Suppress("DEPRECATION")
                    val code = gatt.writeDescriptor(cccd)
                    if (!code) {
                        _state.value = BleConnectionState.Disconnected("启用心率通知描述失败")
                        return
                    }
                }
            }
            val dev = activeDevice ?: return
            _state.value = BleConnectionState.Streaming(
                device = dev,
                hrBpm = null,
                latestRmssdMs = aggregator?.latestRmssdMs,
                validRrCount = aggregator?.totalValidRrCount ?: 0,
                rejectedRrCount = aggregator?.totalRejectedRrCount ?: 0,
                uploadedWindowsCount = uploadedWindowsCount,
                lastPacketAtEpochMs = null,
            )
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            if (characteristic.uuid == HEART_RATE_MEASUREMENT_CHAR_UUID) {
                handleHeartRatePayload(value)
            }
        }

        @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU &&
                characteristic.uuid == HEART_RATE_MEASUREMENT_CHAR_UUID
            ) {
                characteristic.value?.let(::handleHeartRatePayload)
            }
        }
    }

    private fun handleHeartRatePayload(payload: ByteArray) {
        val parsed = HeartRateMeasurementParser.parse(payload) ?: return
        val agg = aggregator ?: return
        val dev = activeDevice ?: return
        val now = clock()

        val closedWindowSamples = agg.addMeasurement(parsed, now.epochSecond)
        _state.value = BleConnectionState.Streaming(
            device = dev,
            hrBpm = parsed.heartRateBpm,
            latestRmssdMs = agg.latestRmssdMs,
            validRrCount = agg.totalValidRrCount,
            rejectedRrCount = agg.totalRejectedRrCount,
            uploadedWindowsCount = uploadedWindowsCount,
            lastPacketAtEpochMs = now.toEpochMilli(),
        )

        if (closedWindowSamples.isNotEmpty()) {
            scope.launch {
                enqueueAndFlush(closedWindowSamples)
            }
        }
    }

    private suspend fun enqueueAndFlush(samples: List<PendingBiometricEntity>) {
        uploadQueue.enqueue(samples)
        val result = uploadQueue.flushPending()
        if (result is BiometricFlushResult.Success) {
            uploadedWindowsCount++
            val current = _state.value
            if (current is BleConnectionState.Streaming) {
                _state.value = current.copy(uploadedWindowsCount = uploadedWindowsCount)
            }
            if (result.latestEnergy != null) {
                syncPreferencesStore.saveCachedEnergyJson(ShixuJson.json.encodeToString(result.latestEnergy))
                _latestEnergyFromBle.tryEmit(result.latestEnergy)
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun scheduleReconnectOrFallback(status: Int) {
        val dev = activeDevice
        if (dev == null || reconnectAttempt >= RECONNECT_DELAYS_MS.size || !hasPermissions()) {
            _state.value = BleConnectionState.Disconnected(
                "蓝牙连接已断开 (status=$status)，已自动保留未传窗口；可重连或切换 Health Connect",
            )
            return
        }

        val delayMs = RECONNECT_DELAYS_MS[reconnectAttempt]
        reconnectAttempt++
        _state.value = BleConnectionState.Connecting(dev)
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
            val btDevice = runCatching { adapter?.getRemoteDevice(dev.address) }.getOrNull()
            if (btDevice == null || userInitiatedDisconnect || !hasPermissions()) {
                _state.value = BleConnectionState.Disconnected("重连失败，可切换回 Health Connect 同步")
                return@launch
            }
            activeGatt = btDevice.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        }
    }

    companion object {
        val HEART_RATE_SERVICE_UUID: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val HEART_RATE_MEASUREMENT_CHAR_UUID: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        private const val SCAN_DURATION_MS = 15_000L
        private val RECONNECT_DELAYS_MS = longArrayOf(2_000L, 5_000L, 15_000L)
    }
}
