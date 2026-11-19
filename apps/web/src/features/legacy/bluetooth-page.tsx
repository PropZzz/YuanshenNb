import { useEffect, useRef, useState } from "react";
import { Bluetooth, HeartPulse, Info, Link2Off, ListTree, Radio, RefreshCw, Send, ShieldCheck, Terminal, Watch } from "@/components/ui/reference-icons";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/states";
import { CapabilityNote, EmptyBlock, LegacyHeader, SectionHeading, SystemNav } from "./legacy-shared";

type GattCharacteristic = EventTarget & { uuid: string; value?: DataView; properties: { read?: boolean; notify?: boolean; indicate?: boolean; write?: boolean; writeWithoutResponse?: boolean }; readValue(): Promise<DataView>; startNotifications(): Promise<GattCharacteristic>; stopNotifications(): Promise<GattCharacteristic>; writeValueWithResponse(value: Uint8Array): Promise<void>; writeValueWithoutResponse(value: Uint8Array): Promise<void> };
type GattService = { uuid: string; isPrimary: boolean; getCharacteristics(): Promise<GattCharacteristic[]> };
type GattServer = { connected: boolean; connect(): Promise<GattServer>; disconnect(): void; getPrimaryServices(): Promise<GattService[]> };
type BleDevice = EventTarget & { id: string; name?: string; gatt?: GattServer };
type WebBluetooth = { requestDevice(options: { filters: { services: string[] }[]; optionalServices: string[] }): Promise<BleDevice> };
type ServiceTree = { service: GattService; characteristics: GattCharacteristic[] };
const serviceNames: Record<string, string> = { "0000180d-0000-1000-8000-00805f9b34fb": "Heart Rate Service", "0000180f-0000-1000-8000-00805f9b34fb": "Battery Service", "0000180a-0000-1000-8000-00805f9b34fb": "Device Information" };
const characteristicNames: Record<string, string> = { "00002a37-0000-1000-8000-00805f9b34fb": "Heart Rate Measurement", "00002a38-0000-1000-8000-00805f9b34fb": "Body Sensor Location", "00002a19-0000-1000-8000-00805f9b34fb": "Battery Level" };
function hex(value: DataView) { return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).map(byte => byte.toString(16).padStart(2, "0").toUpperCase()).join(" "); }

export function BluetoothPage() {
  const bluetooth = (navigator as Navigator & { bluetooth?: WebBluetooth }).bluetooth;
  const supported = Boolean(bluetooth), secure = window.isSecureContext === true;
  const [device, setDevice] = useState<BleDevice | null>(null), [tree, setTree] = useState<ServiceTree[]>([]), [connecting, setConnecting] = useState(false), [reading, setReading] = useState(""), [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState("");
  const [values, setValues] = useState<Record<string, { hex: string; at: string }>>({}), [subscribed, setSubscribed] = useState<string[]>([]), [writeTarget, setWriteTarget] = useState(""), [payload, setPayload] = useState("");
  const active = useRef<BleDevice | null>(null), listeners = useRef(new Map<GattCharacteristic, EventListener>()), mounted = useRef(true), session = useRef(0);
  function current(turn: number) { return mounted.current && session.current === turn; }
  function cleanSubscriptions() { listeners.current.forEach((listener, characteristic) => { characteristic.removeEventListener("characteristicvaluechanged", listener); void characteristic.stopNotifications().catch(() => {}); }); listeners.current.clear(); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; session.current++; listeners.current.forEach((listener, characteristic) => { characteristic.removeEventListener("characteristicvaluechanged", listener); void characteristic.stopNotifications().catch(() => {}); }); listeners.current.clear(); active.current?.gatt?.disconnect(); active.current = null; }; }, []);
  useEffect(() => { if (!device) return; function disconnected() { if (!mounted.current || active.current !== device) return; session.current++; cleanSubscriptions(); active.current = null; setDevice(null); setTree([]); setSubscribed([]); setValues({}); setConnecting(false); setReading(""); setNotice("设备连接已断开，遥测数据已清除。"); } device.addEventListener("gattserverdisconnected", disconnected); return () => device.removeEventListener("gattserverdisconnected", disconnected); }, [device]);
  async function inspect(server: GattServer, turn = session.current) { const services = await server.getPrimaryServices(); if (!current(turn)) return; const next = await Promise.all(services.map(async service => ({ service, characteristics: await service.getCharacteristics() }))); if (current(turn)) setTree(next); }
  async function connect() {
    if (!bluetooth || !secure || connecting) return;
    const turn = ++session.current;
    setConnecting(true); setError(null); setNotice("");
    try {
      const selected = await bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }], optionalServices: ["battery_service", "device_information"] });
      if (!current(turn)) return;
      if (!selected.gatt) throw new Error("所选设备未提供可用的 GATT 服务");
      const server = await selected.gatt.connect();
      if (!current(turn)) { server.disconnect(); return; }
      cleanSubscriptions(); if (active.current && active.current.id !== selected.id) active.current.gatt?.disconnect();
      active.current = selected; setDevice(selected); setValues({}); setSubscribed([]); setWriteTarget(""); setNotice("已连接你授权的设备；测量值仅在读取或订阅后显示。");
      try { await inspect(server, turn); } catch (cause) { if (current(turn)) setError(new Error(`已连接，但服务读取未完成：${cause instanceof Error ? cause.message : "请重新连接后重试"}`)); }
    } catch (cause) { if (current(turn)) setError(cause instanceof DOMException && cause.name === "NotFoundError" ? new Error("已取消设备选择，未建立新连接。") : cause instanceof Error ? cause : new Error("设备连接未完成")); }
    finally { if (current(turn)) setConnecting(false); }
  }
  function disconnect() { session.current++; cleanSubscriptions(); const current = active.current; active.current = null; current?.gatt?.disconnect(); setDevice(null); setTree([]); setSubscribed([]); setValues({}); setWriteTarget(""); setConnecting(false); setReading(""); setNotice("设备已断开，遥测数据已清除。"); }
  function record(characteristic: GattCharacteristic, value: DataView) { setValues(current => ({ ...current, [characteristic.uuid]: { hex: hex(value), at: new Date().toLocaleTimeString("zh-CN", { hour12: false }) } })); }
  async function read(characteristic: GattCharacteristic) { const turn = session.current; setReading(characteristic.uuid); setError(null); try { const value = await characteristic.readValue(); if (current(turn)) record(characteristic, value); } catch (cause) { if (current(turn)) setError(cause as Error); } finally { if (current(turn)) setReading(""); } }
  async function toggleNotify(characteristic: GattCharacteristic) {
    const turn = session.current;
    setReading(characteristic.uuid); setError(null);
    try {
      if (subscribed.includes(characteristic.uuid)) {
        await characteristic.stopNotifications();
        const listener = listeners.current.get(characteristic);
        if (listener) characteristic.removeEventListener("characteristicvaluechanged", listener);
        listeners.current.delete(characteristic);
        if (current(turn)) setSubscribed(values => values.filter(uuid => uuid !== characteristic.uuid));
      } else {
        const listener: EventListener = () => { if (current(turn) && characteristic.value) record(characteristic, characteristic.value); };
        characteristic.addEventListener("characteristicvaluechanged", listener);
        listeners.current.set(characteristic, listener);
        try { await characteristic.startNotifications(); }
        catch (cause) { characteristic.removeEventListener("characteristicvaluechanged", listener); listeners.current.delete(characteristic); throw cause; }
        if (!current(turn)) { characteristic.removeEventListener("characteristicvaluechanged", listener); listeners.current.delete(characteristic); void characteristic.stopNotifications().catch(() => {}); return; }
        setSubscribed(values => [...values, characteristic.uuid]);
      }
    } catch (cause) { if (current(turn)) setError(cause as Error); }
    finally { if (current(turn)) setReading(""); }
  }
  const writable = tree.flatMap(node => node.characteristics).filter(characteristic => characteristic.properties.write || characteristic.properties.writeWithoutResponse);
  async function write() { const characteristic = writable.find(item => item.uuid === writeTarget); if (!characteristic) { setError(new Error("请先选择设备实际提供的可写特征值")); return; } const normalized = payload.trim().replace(/0x/gi, "").replace(/\s+/g, ""); if (!normalized || normalized.length % 2 || !/^[0-9a-f]+$/i.test(normalized)) { setError(new Error("请输入完整的十六进制字节，例如每个字节两位；不会自动补齐载荷。")); return; } const bytes = new Uint8Array(normalized.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16))); if (bytes.length > 512) { setError(new Error("单次最多发送 512 字节，请按设备协议确认载荷长度。")); return; } setError(null); setReading("write"); try { if (characteristic.properties.write) { await characteristic.writeValueWithResponse(bytes); setNotice("特征写入完成：GATT 响应已返回。该响应不代表设备完成了额外操作。"); } else { await characteristic.writeValueWithoutResponse(bytes); setNotice("浏览器已发送载荷；此特征不返回设备确认，不能判断远端执行结果。"); } } catch (cause) { setError(cause as Error); } finally { setReading(""); } }
  return <div className="legacy-page legacy-bluetooth"><SystemNav /><LegacyHeader eyebrow="系统 / 外设与传感器 / 蓝牙设备管理" title="蓝牙外设连接与传感器管理" subtitle="Hardware & Bluetooth Sensors · 真实授权与 GATT 特征值检查" actions={<><span className="legacy-badge"><Radio size={13} />{device ? "已建立 GATT 连接" : "未连接设备"}</span><Button disabled={!supported || !secure || Boolean(device)} pending={connecting} onClick={() => void connect()}><Bluetooth size={16} />选择并连接设备</Button></>} />
    <div className="legacy-bluetooth-policy"><ShieldCheck size={22} /><div><h2>沙箱运行环境安全约束声明（Web Bluetooth Limitation）</h2><p>{!supported ? "当前浏览器不支持 Web Bluetooth。请使用支持该能力的浏览器，或通过 Android 端采集同步生理数据。" : !secure ? "当前页面不是安全上下文。Web Bluetooth 需要 HTTPS 或 localhost，无法在当前地址授权连接。" : "设备选择必须由你点击授权。浏览器只能读取明确授权的 GATT 服务，不会在后台持续扫描周边设备。"}</p><small>本页仅支持心率服务设备，附带电池与设备信息可选权限。不会在前端计算 HRV 或精力评分。</small></div></div><InlineError error={error} />{notice && <p className="notice" role="status">{notice}</p>}
    <div className="legacy-bluetooth-grid"><div className="legacy-stack"><section className="legacy-card"><SectionHeading icon={HeartPulse} title="已连接生理传感器" detail={device ? "GATT 会话活跃" : "等待授权"} />{device ? <><div className="legacy-device"><span><HeartPulse size={29} /></span><div><h3>{device.name || "未命名的已授权设备"}</h3><small>心率服务 · 浏览器授权连接</small></div></div><div className="legacy-telemetry"><div><span>实时脉率（HR）</span><strong>—<small>BPM</small></strong><small>当前仅显示原始 GATT 数据</small></div><div><span>R-R 间期</span><strong>—<small>ms</small></strong><small>未运行前端生理指标算法</small></div></div><Button variant="outline" onClick={disconnect}><Link2Off size={15} />断开设备</Button></> : <EmptyBlock title="尚未连接生理传感器" description="点击“选择并连接设备”，在浏览器选择器中授权你的真实设备。" />}</section><section className="legacy-card"><SectionHeading icon={Watch} title="周边发现的 BLE 设备" /><EmptyBlock title="由浏览器管理设备发现" description="设备候选仅显示在浏览器的授权选择器中。此处不会列出虚构设备、信号强度或电池电量。" /><Button variant="outline" disabled={!supported || !secure || Boolean(device)} pending={connecting} onClick={() => void connect()}>打开设备选择器</Button></section><section className="legacy-card"><SectionHeading title="认知节律协同模型配置" /><div className="legacy-disabled-setting"><div><h3>将硬件 HRV 作为认知负荷参考</h3><p>当前没有 Web 端遥测上传与调度权重契约。请通过已支持的 Android 生理数据采集链路同步。</p></div><input aria-label="硬件HRV协同模型（未接入）" type="checkbox" disabled /></div><span className="legacy-badge">未启用 · 不影响现有服务端模型</span></section></div>
      <div className="legacy-stack"><section className="legacy-card legacy-gatt"><SectionHeading icon={ListTree} title="GATT 服务与特征值检查器"><Button variant="ghost" size="sm" disabled={!device || Boolean(reading)} onClick={async () => { if (!device?.gatt) return; setReading("tree"); setError(null); try { await inspect(device.gatt); } catch (cause) { setError(cause as Error); } finally { setReading(""); } }}><RefreshCw size={13} />刷新全树</Button></SectionHeading>{!tree.length ? <EmptyBlock title={device ? "未读取到已授权服务" : "等待设备连接"} description={device ? "设备连接已建立，但当前授权服务为空；可尝试刷新全树或重新连接。" : "连接后会列出设备实际提供的服务与特征值。"} /> : tree.map((node, index) => <article className="legacy-gatt-service" key={node.service.uuid}><div><Bluetooth size={17} /><h3>Service {index + 1}: {serviceNames[node.service.uuid] ?? "已授权服务"}</h3><span className="legacy-badge">{node.service.isPrimary ? "Primary Service" : "Service"}</span></div><code>{node.service.uuid}</code>{node.characteristics.map(characteristic => <div className="legacy-gatt-characteristic" key={characteristic.uuid}><strong>{characteristicNames[characteristic.uuid] ?? "Characteristic"}</strong><code>{characteristic.uuid}</code><div className="legacy-actions">{characteristic.properties.read && <Button size="sm" variant="outline" disabled={Boolean(reading)} onClick={() => void read(characteristic)}>读取特征值</Button>}{(characteristic.properties.notify || characteristic.properties.indicate) && <Button size="sm" variant="outline" disabled={Boolean(reading)} onClick={() => void toggleNotify(characteristic)}>{subscribed.includes(characteristic.uuid) ? "停止通知流" : "订阅通知流"}</Button>}{characteristic.properties.write && <span className="legacy-badge">Write</span>}{characteristic.properties.writeWithoutResponse && <span className="legacy-badge">Write Without Response</span>}</div><div className="legacy-gatt-value"><span>最新原始 Hex 数据包</span><code>{values[characteristic.uuid]?.hex || "— 尚未读取或收到通知"}</code>{values[characteristic.uuid] && <small>接收于 {values[characteristic.uuid].at}</small>}</div></div>)}</article>)}</section>
      <section className="legacy-card legacy-gatt-write"><SectionHeading icon={Terminal} title="硬件指令直接写入" detail="Hex Dispatch" /><CapabilityNote>仅向设备实际声明为可写的特征发送你输入的字节。请先核对硬件协议；不会使用只读测量特征伪造写入成功。</CapabilityNote><div className="legacy-form"><label>GATT 写入特征值<select value={writeTarget} onChange={event => setWriteTarget(event.target.value)} disabled={!writable.length}><option value="">{writable.length ? "选择可写特征值" : "暂无已授权的可写特征值"}</option>{writable.map(characteristic => <option key={characteristic.uuid} value={characteristic.uuid}>{characteristicNames[characteristic.uuid] ?? characteristic.uuid}</option>)}</select></label><label>十六进制写入载荷<input value={payload} onChange={event => setPayload(event.target.value)} spellCheck={false} disabled={!writable.length} placeholder="按设备协议填写字节载荷" /></label><Button disabled={!writeTarget || !payload.trim() || Boolean(reading)} onClick={() => void write()}><Send size={15} />十六进制写入</Button></div></section><div className="legacy-capability"><Info size={18} /><p>原始 GATT 数据只保留在当前页面内存中。离开页面或断开连接会停止本页订阅；本页不会伪造持续采样、HRV 结果或能量分数。</p></div></div></div>
  </div>;
}
