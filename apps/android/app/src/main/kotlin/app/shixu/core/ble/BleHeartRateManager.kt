package app.shixu.core.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import app.shixu.core.database.PendingUploadQueue
import app.shixu.core.health.SampleIdentity
import app.shixu.core.health.HealthSync
import app.shixu.core.network.generated.models.*
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class BleDevice(val address: String, val name: String)
data class BleConnectionState(val status: String = "Disconnected", val message: String = "尚未连接标准心率设备", val devices: List<BleDevice> = emptyList(), val bpm: Int? = null, val rmssd: Double? = null)

/** Foreground acquisition only: the UI explicitly asks the user to keep this app open. */
@SuppressLint("MissingPermission")
@Singleton
class BleHeartRateManager @Inject constructor(@ApplicationContext private val context: Context, private val queue: PendingUploadQueue) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(BleConnectionState())
    val state = _state.asStateFlow()
    private val adapter get() = context.getSystemService(BluetoothManager::class.java)?.adapter
    @Volatile private var gatt: BluetoothGatt? = null
    private var owner: String? = null
    @Volatile private var deviceAddress: String? = null
    private var windowStart: Long? = null
    private val heartRates = mutableListOf<Int>()
    private val rr = RrWindow()
    private var scanTimeout: Job? = null
    fun setOwner(id: String?) { if (id != owner) { disconnect(); owner = id } }
    fun hasPermissions(): Boolean = requiredPermissions().all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
    fun scan() {
        if (!hasPermissions()) { _state.value = BleConnectionState(message = "请先授予蓝牙扫描与连接权限"); return }
        if (adapter?.isEnabled != true) { _state.value = BleConnectionState(message = "请在系统中打开蓝牙"); return }
        disconnect()
        _state.value = BleConnectionState("Scanning", "正在查找标准心率服务 0x180D")
        adapter?.bluetoothLeScanner?.startScan(listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(HEART_RATE_SERVICE)).build()), ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
        scanTimeout = scope.launch { delay(20_000); stopScan(); _state.value = _state.value.copy(status = "Disconnected", message = if (_state.value.devices.isEmpty()) "未发现标准心率设备，请检查佩戴和广播设置" else "请选择一台设备连接") }
    }
    private fun stopScan() { scanTimeout?.cancel(); if (hasPermissions()) adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
    fun connect(address: String) {
        if (!hasPermissions() || owner == null) return
        val devices = _state.value.devices
        disconnect(); deviceAddress = address
        _state.value = _state.value.copy(status = "Connecting", message = "正在连接心率服务…", devices = devices)
        gatt = adapter?.getRemoteDevice(address)?.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    }
    @Synchronized fun disconnect() {
        stopScan()
        if (hasPermissions()) { gatt?.disconnect(); gatt?.close() }
        gatt = null; deviceAddress = null; heartRates.clear(); rr.clear(); windowStart = null
        _state.value = BleConnectionState()
    }
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = BleDevice(result.device.address, result.device.name ?: "标准心率设备")
            _state.value = _state.value.copy(devices = (_state.value.devices + device).distinctBy { it.address })
        }
        override fun onScanFailed(errorCode: Int) { _state.value = _state.value.copy(status = "Disconnected", message = "扫描失败 ($errorCode)，请检查系统蓝牙权限") }
    }
    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (g !== gatt) return
            if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) g.discoverServices()
            else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                g.close(); gatt = null; _state.value = _state.value.copy(status = "Disconnected", bpm = null, rmssd = null, message = "设备已断开，可重新连接或切换 Health Connect")
                synchronized(this@BleHeartRateManager) { heartRates.clear(); rr.clear(); windowStart = null }
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (g !== gatt) return
            val measurement = g.getService(HEART_RATE_SERVICE)?.getCharacteristic(HEART_RATE_MEASUREMENT)
            val descriptor = measurement?.getDescriptor(CLIENT_CONFIG)
            if (status != BluetoothGatt.GATT_SUCCESS || measurement == null || descriptor == null) { _state.value = _state.value.copy(status = "Disconnected", message = "设备未提供标准 0x2A37 心率通知"); g.disconnect(); return }
            g.setCharacteristicNotification(measurement, true)
            if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            else { @Suppress("DEPRECATION") descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; @Suppress("DEPRECATION") g.writeDescriptor(descriptor) }
        }
        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (g !== gatt) return
            _state.value = _state.value.copy(status = if (status == BluetoothGatt.GATT_SUCCESS) "Streaming" else "Disconnected", message = if (status == BluetoothGatt.GATT_SUCCESS) "心率实时采集中 · 每 60 秒上报，请保持应用在前台" else "无法订阅心率通知 ($status)")
        }
        @Deprecated("Used by Android 12 and earlier")
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (g === gatt && Build.VERSION.SDK_INT < 33) { @Suppress("DEPRECATION") val value = characteristic.value; accept(g.device.address, characteristic.uuid, value) }
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) { if (g === gatt) accept(g.device.address, characteristic.uuid, value) }
    }
    @Synchronized private fun accept(address: String, characteristic: UUID, raw: ByteArray) {
        if (characteristic != HEART_RATE_MEASUREMENT || address != deviceAddress) return
        val measurement = HeartRateMeasurement.parse(raw) ?: return
        if (measurement.bpm !in 30..220) return
        val epoch = Instant.now().epochSecond / 60 * 60
        val start = windowStart
        if (start != null && start != epoch) {
            val user = owner
            val hrv = rr.rmssd()
            val samples = mutableListOf<BiometricSampleDTO>()
            fun append(metric: MetricType, value: Double, unit: String) { samples += BiometricSampleDTO(SampleIdentity.ble(address, metric.value, start), metric, value, Instant.ofEpochSecond(start).atOffset(ZoneOffset.UTC), SourceType.ble_gatt, unit) }
            if (heartRates.isNotEmpty()) append(MetricType.heart_rate, heartRates.average(), "bpm")
            if (hrv != null && hrv <= 250.0) append(MetricType.hrv_rmssd, hrv, "ms")
            if (user != null && samples.isNotEmpty()) scope.launch { queue.enqueue(user, samples); HealthSync.syncNow(context) }
            heartRates.clear(); rr.clear()
        }
        windowStart = epoch; heartRates += measurement.bpm; rr.add(measurement.rrMillis)
        _state.value = _state.value.copy(status = "Streaming", bpm = measurement.bpm, rmssd = rr.rmssd())
    }
    companion object {
        val HEART_RATE_SERVICE: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val HEART_RATE_MEASUREMENT: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        val CLIENT_CONFIG: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        fun requiredPermissions(): Array<String> = if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT) else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
}
