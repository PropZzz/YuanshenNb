export type SoundscapeKind = "rain" | "cafe" | "ocean" | "brown";
export type SoundscapePlayback = { setVolume: (volume: number) => void; stop: () => void };
const presets = {
  rain: { frequency: 2600, type: "highpass", level: .11, modulation: .035 },
  cafe: { frequency: 650, type: "bandpass", level: .16, modulation: .21 },
  ocean: { frequency: 420, type: "lowpass", level: .22, modulation: .12 },
  brown: { frequency: 1100, type: "lowpass", level: .26, modulation: 0 },
} satisfies Record<SoundscapeKind, { frequency: number; type: BiquadFilterType; level: number; modulation: number }>;

export async function startSoundscape(kind: SoundscapeKind, volume: number): Promise<SoundscapePlayback> {
  if (typeof globalThis.AudioContext !== "function") throw new Error("此浏览器暂不支持合成声音，请使用支持浏览器音频的设备。");
  const context = new AudioContext({ latencyHint: "playback" });
  const nodes: AudioNode[] = [], sources: (AudioBufferSourceNode | OscillatorNode)[] = [];
  let stopped = false;
  function stop() {
    if (stopped) return; stopped = true;
    for (const source of sources) { try { source.stop(); } catch { /* A failed startup may not have reached start(). */ } }
    for (const node of nodes) node.disconnect();
    void context.close().catch(() => undefined);
  }
  try {
    const preset = presets[kind], source = context.createBufferSource(), filter = context.createBiquadFilter(), output = context.createGain();
    nodes.push(source, filter, output); sources.push(source);
    const sampleCount = context.sampleRate * 2, buffer = context.createBuffer(1, sampleCount, context.sampleRate), samples = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < sampleCount; index++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + .02 * white) / 1.02;
      samples[index] = kind === "brown" || kind === "ocean" ? brown * 3.5 : white;
    }
    source.buffer = buffer; source.loop = true;
    filter.type = preset.type; filter.frequency.value = preset.frequency; filter.Q.value = .65;
    source.connect(filter); filter.connect(output); output.connect(context.destination);
    let modulation: GainNode | undefined;
    if (preset.modulation > 0) {
      const oscillator = context.createOscillator(); modulation = context.createGain();
      nodes.push(oscillator, modulation); sources.push(oscillator);
      oscillator.type = "sine"; oscillator.frequency.value = preset.modulation;
      oscillator.connect(modulation); modulation.connect(output.gain);
    }
    function setVolume(next: number) {
      if (stopped) return;
      const level = Math.min(1, Math.max(0, next)) * preset.level;
      output.gain.setTargetAtTime(level, context.currentTime, .08);
      modulation?.gain.setTargetAtTime(level * .35, context.currentTime, .08);
    }
    output.gain.value = 0; if (modulation) modulation.gain.value = 0;
    setVolume(volume); await context.resume(); for (const node of sources) node.start();
    return { setVolume, stop };
  } catch (error) { stop(); throw error; }
}
