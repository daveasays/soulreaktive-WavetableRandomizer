import {
  initialize,
  type ActivationContext,
  type Handle,
  MidiTrack,
  Device,
  DeviceParameter,
} from "@ableton-extensions/sdk";

import dialInterface from "./dial.html";

const EXCLUDED_PARAMS = new Set([
  "Device On",
  "Volume",
  "Transpose",
  "Detune",
]);

const OSC_ON_PARAMS = ["Osc 1 On", "Osc 2 On", "Sub On"];

// -10dB = 0.5623, -20dB = 0.3162 — on cible -12dB ≈ 0.50
const VOLUME_MAX = 0.50;

function randomizeParam(param: DeviceParameter<"1.0.0">, intensity: number): number {
  const range = param.max - param.min;
  if (param.isQuantized) {
    const items = param.valueItems;
    const count = items.length > 0 ? items.length : Math.round(range) + 1;
    const randomIndex = Math.floor(Math.random() * count);
    return param.min + randomIndex;
  }
  const center = (param.min + param.max) / 2;
  const targetRandom = param.min + Math.random() * range;
  return center + (targetRandom - center) * intensity;
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("wavetable.randomize", async (arg: unknown) => {
    const handle = arg as Handle;
    const track = context.getObjectFromHandle(handle, MidiTrack);

    const wavetableDevices = track.devices.filter((d: Device<"1.0.0">) => {
      const names = new Set(d.parameters.map((p: DeviceParameter<"1.0.0">) => p.name));
      return names.has("Osc 1 On") && names.has("Osc 1 Pos") && names.has("Unison Amount");
    });

    if (wavetableDevices.length === 0) {
      console.log(`[Wavetable Randomizer] Aucun Wavetable sur "${track.name}".`);
      return;
    }

    let result: string;
    try {
      result = await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(dialInterface)}`,
        320,
        340
      );
    } catch {
      console.log("[Wavetable Randomizer] Annulé.");
      return;
    }

    const parsed = JSON.parse(result) as { intensity: number | null };
    if (parsed.intensity === null) {
      console.log("[Wavetable Randomizer] Annulé.");
      return;
    }

    const intensity = parsed.intensity;

    for (const device of wavetableDevices) {
      const allParams = device.parameters;

      const oscOnParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) => OSC_ON_PARAMS.includes(p.name)
      );
      const volumeParam = allParams.find(
        (p: DeviceParameter<"1.0.0">) => p.name === "Volume"
      );
      const randomizableParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) => !EXCLUDED_PARAMS.has(p.name) && !OSC_ON_PARAMS.includes(p.name)
      );

      await context.withinTransaction(() =>
        Promise.all([
          ...randomizableParams.map(async (param: DeviceParameter<"1.0.0">) => {
            try {
              await param.setValue(randomizeParam(param, intensity));
            } catch (e) {
              console.log(`  ✗ ${param.name}: skipped (${e})`);
            }
          }),
          ...oscOnParams.map(async (param: DeviceParameter<"1.0.0">) =>
            param.setValue(Math.random() < 0.5 ? 0 : 1)
          ),
        ])
      );

      // Garantir au moins un OSC allumé
      const oscOnValues = await Promise.all(
        oscOnParams.map((p: DeviceParameter<"1.0.0">) => p.getValue())
      );
      const anyOscOn = oscOnValues.some((v) => v > 0);
      if (!anyOscOn) {
        const osc1 = oscOnParams.find((p: DeviceParameter<"1.0.0">) => p.name === "Osc 1 On");
        if (osc1) await osc1.setValue(1);
      }

      // Forcer le volume à -12dB max
      if (volumeParam) {
        await volumeParam.setValue(VOLUME_MAX);
      }

      console.log(`[Wavetable Randomizer] ✓ "${track.name}" — ${Math.round(intensity * 100)}% — volume -12dB.`);
    }
  });

  context.ui.registerContextMenuAction(
    "MidiTrack",
    "Randomize Wavetable",
    "wavetable.randomize"
  );

  console.log("[Wavetable Randomizer] Activé.");
}
