// Composition root that wires the REAL offline-voice dependencies into the store.
//
// Kept in `src/model` (not `src/voice`) because it constructs the network-backed
// artifact adapter; `configureVoiceDependencies()` is the single injection seam
// the store exposes. Called once at app startup (AppNavigator bootstrap).
//
// Every native touchpoint (filesystem paths, resource policy, whisper.rn runtime)
// is resolved lazily inside the constructed objects, so importing this module never
// loads a native package. If anything throws while assembling, the caller keeps
// the store's default "unavailable" dependencies rather than crashing startup.

import { deviceResourcePolicy } from '../../inference/DeviceResourcePolicy';
import { configureVoiceDependencies } from '../../store/voiceStore';
import { DEFAULT_VOICE_MODEL } from '../../voice/VoiceModelDescriptor';
import { VoiceModelLifecycle } from '../../voice/VoiceModelLifecycle';
import { voicePermissionAdapter } from '../../voice/voicePermission';
import { VoiceSessionService } from '../../voice/VoiceSessionService';
import { createWhisperVoiceRuntime } from '../../voice/WhisperVoiceRuntime';

import { VoiceModelArtifactAdapter, voiceModelDirectory } from './VoiceModelArtifact';

/**
 * Assembles the real lifecycle (artifact download/verify/remove + mic permission)
 * and the real record-then-transcribe session service (whisper runtime + lease), then
 * installs them into the voice store. Safe to call unconditionally at startup; the
 * mic UI stays hidden behind VOICE_INPUT_ENABLED until a device build validates it.
 */
export function configureRealVoiceDependencies(): void {
  const descriptor = DEFAULT_VOICE_MODEL;
  const lifecycle = new VoiceModelLifecycle(
    new VoiceModelArtifactAdapter(descriptor),
    voicePermissionAdapter,
  );
  const runtime = createWhisperVoiceRuntime({
    descriptor,
    modelDirectory: voiceModelDirectory(descriptor),
  });
  const session = new VoiceSessionService(runtime, deviceResourcePolicy);
  configureVoiceDependencies({ lifecycle, session });
}
