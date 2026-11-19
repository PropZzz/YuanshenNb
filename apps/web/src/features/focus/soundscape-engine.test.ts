import { afterEach, describe, expect, it, vi } from "vitest";
import { startSoundscape } from "./soundscape-engine";

afterEach(() => vi.unstubAllGlobals());
describe("real local soundscape lifecycle", () => {
  it("starts a looped noise buffer, changes gain and cleans up the source, modulation and context", async () => {
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), type: "", loop: false, buffer: undefined as unknown, gain: { value: 0, setTargetAtTime: vi.fn() }, frequency: { value: 0 }, Q: { value: 0 } });
    const source = node(), oscillator = node(), output = node(), modulation = node(), filter = node();
    const samples = new Float32Array(16000), close = vi.fn(async () => undefined), resume = vi.fn(async () => undefined);
    let gains = 0;
    class LocalAudio { sampleRate = 8000; currentTime = 0; destination = {}; createBuffer() { return { getChannelData: () => samples }; } createBufferSource() { return source; } createBiquadFilter() { return filter; } createGain() { return gains++ === 0 ? output : modulation; } createOscillator() { return oscillator; } close = close; resume = resume; }
    vi.stubGlobal("AudioContext", LocalAudio);
    const playback = await startSoundscape("ocean", .65);
    expect(resume).toHaveBeenCalledOnce(); expect(source.start).toHaveBeenCalledOnce(); expect(source.loop).toBe(true);
    expect(samples.some(sample => sample !== 0)).toBe(true); expect(oscillator.start).toHaveBeenCalledOnce();
    playback.setVolume(.2); expect(output.gain.setTargetAtTime).toHaveBeenCalled();
    playback.stop(); playback.stop();
    expect(source.stop).toHaveBeenCalledOnce(); expect(source.disconnect).toHaveBeenCalledOnce(); expect(oscillator.stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it("reports unavailable browser audio without returning a pretend playback", async () => {
    vi.stubGlobal("AudioContext", undefined); await expect(startSoundscape("rain", .65)).rejects.toThrow(/声音/);
  });
});
