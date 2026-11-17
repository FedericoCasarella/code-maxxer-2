// cm2-dictate: live dictation with Apple's on-device speech recognizer.
// stdout: JSON lines {"type":"ready"|"partial"|"final"|"level"|"error", ...}; stdin: "stop" (keep text) or EOF.
// It re-launches itself as its own "responsible" process so macOS asks for (and remembers) the
// microphone and speech permissions for this helper, using the Info.plist embedded in the binary.
import AVFoundation
import Foundation
import Speech

@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attrs: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

setvbuf(stdout, nil, _IOLBF, 0)
func emit(_ obj: [String: Any]) {
  if let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) { print(s) }
}

if ProcessInfo.processInfo.environment["CM2_DICTATE_CHILD"] == nil {
  var attr: posix_spawnattr_t?
  posix_spawnattr_init(&attr)
  _ = responsibility_spawnattrs_setdisclaim(&attr, 1)
  var env = ProcessInfo.processInfo.environment
  env["CM2_DICTATE_CHILD"] = "1"
  let envp = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
  let args = CommandLine.arguments.map { strdup($0) } + [nil]
  var pid: pid_t = 0
  let rc = posix_spawn(&pid, CommandLine.arguments[0], nil, &attr, args, envp)
  if rc != 0 { emit(["type": "error", "message": "spawn failed \(rc)"]); exit(1) }
  var status: Int32 = 0
  waitpid(pid, &status, 0)
  exit(0)
}

let wanted = Locale(identifier: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : Locale.current.identifier)
let engine = AVAudioEngine()
var stopRequested = false

func levelOf(_ buf: AVAudioPCMBuffer) {
  guard let ch = buf.floatChannelData?[0] else { return }
  var sum: Float = 0
  let n = Int(buf.frameLength)
  for i in 0..<n { sum += ch[i] * ch[i] }
  emit(["type": "level", "rms": Double(sqrt(sum / Float(max(n, 1))))])
}

// macOS 26+: SpeechAnalyzer, on-device, works with Siri and Dictation turned off.
@available(macOS 26.0, *)
func runAnalyzer() async {
  guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) else {
    emit(["type": "error", "message": "Dictation doesn't support \(wanted.identifier) yet"]); exit(1)
  }
  let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults], attributeOptions: [])
  do {
    if await AssetInventory.status(forModules: [transcriber]) != .installed,
       let req = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      emit(["type": "status", "message": "Downloading the speech model for \(locale.identifier)…"])
      try await req.downloadAndInstall()
    }
  } catch { emit(["type": "error", "message": "Speech model: \(error.localizedDescription)"]); exit(1) }
  let analyzer = SpeechAnalyzer(modules: [transcriber])
  guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
    emit(["type": "error", "message": "No audio format for the recognizer"]); exit(1)
  }
  let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
  let input = engine.inputNode
  let micFormat = input.outputFormat(forBus: 0)
  guard let converter = AVAudioConverter(from: micFormat, to: format) else {
    emit(["type": "error", "message": "Can't convert the microphone audio"]); exit(1)
  }
  input.installTap(onBus: 0, bufferSize: 1024, format: micFormat) { buf, _ in
    levelOf(buf)
    let ratio = format.sampleRate / micFormat.sampleRate
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(Double(buf.frameLength) * ratio) + 32) else { return }
    var fed = false
    var err: NSError?
    converter.convert(to: out, error: &err) { _, status in
      if fed { status.pointee = .noDataNow; return nil }
      fed = true
      status.pointee = .haveData
      return buf
    }
    if err == nil, out.frameLength > 0 { cont.yield(AnalyzerInput(buffer: out)) }
  }
  do { try engine.start() } catch { emit(["type": "error", "message": "Microphone: \(error.localizedDescription)"]); exit(1) }
  // Load the model before the first audio, so the first words aren't late.
  try? await analyzer.prepareToAnalyze(in: format)
  do { try await analyzer.start(inputSequence: stream) } catch { emit(["type": "error", "message": error.localizedDescription]); exit(1) }
  emit(["type": "ready", "locale": locale.identifier, "onDevice": true])
  var done = ""
  do {
    for try await r in transcriber.results {
      let piece = String(r.text.characters)
      if r.isFinal {
        done += piece
        emit(["type": "partial", "text": done.trimmingCharacters(in: .whitespaces)])
      } else {
        emit(["type": "partial", "text": (done + piece).trimmingCharacters(in: .whitespaces)])
      }
    }
  } catch { if !stopRequested { emit(["type": "error", "message": error.localizedDescription]) } }
  _ = cont
}

// stdin: "stop" or EOF ends the dictation.
DispatchQueue.global().async {
  while let line = readLine() { if line.trimmingCharacters(in: .whitespaces) == "stop" { break } }
  stopRequested = true
  DispatchQueue.main.async {
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
  }
}

if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
  emit(["type": "status", "message": "Allow the microphone in the macOS prompt…"])
}
AVCaptureDevice.requestAccess(for: .audio) { ok in
  guard ok else { emit(["type": "error", "message": "Microphone not allowed (System Settings → Privacy & Security → Microphone)"]); exit(1) }
  if #available(macOS 26.0, *) {
    Task { await runAnalyzer() }
  } else {
    emit(["type": "error", "message": "Live dictation needs macOS 26 or later"]); exit(1)
  }
}
RunLoop.main.run()
