import AppKit
import Foundation

let args = CommandLine.arguments
func argument(_ flag: String) -> String? {
  guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
  return args[i + 1]
}
if args.contains(
  where: [
    "--verify-update", "--guard", "--status", "--install", "--set", "--restore", "--uninstall",
  ].contains)
{
  do {
    if let path = argument("--verify-update") {
      let key = Data(
        base64Encoded: text(
          Bundle.main.resourceURL!.appendingPathComponent("update-public-key.txt")
        ).trimmingCharacters(in: .whitespacesAndNewlines))!
      let update = try Updates.verify(Data(contentsOf: URL(fileURLWithPath: path)), key: key)
      print(String(decoding: try JSONEncoder().encode(update), as: UTF8.self))
      exit(0)
    }
    let backend = try Backend(
      base: argument("--base").map { URL(fileURLWithPath: $0) },
      profile: argument("--profile").map { URL(fileURLWithPath: $0) },
      zen: argument("--zen").map { URL(fileURLWithPath: $0) })
    if args.contains("--install") {
      try backend.install()
      if args.contains("--install-guard") { try backend.installGuard() }
    }
    if let value = argument("--set") {
      guard let n = Int(value), (0...100).contains(n) else {
        throw UGError(message: "Прозрачность должна быть от 0 до 100")
      }
      var s = backend.preferences()
      s.transparency = n
      if let on = argument("--enabled") { s.enabled = on == "true" }
      try backend.savePreferences(s)
    }
    if args.contains("--restore") { try backend.restoreLast() }
    if args.contains("--uninstall") { try backend.uninstall() }
    let r = try args.contains("--guard") ? backend.guardOnce() : backend.report()
    print(String(decoding: try JSONEncoder().encode(r), as: UTF8.self))
    if args.contains("--guard"), argument("--base") == nil,
      r.status == "blocked" || r.status == "permission" || r.status == "repaired"
    {
      let marker = backend.base.appendingPathComponent("conflict-notified.json")
      let old = try? readJSON(Report.self, marker)
      if old?.message != r.message {
        try writeJSON(r, marker)
        _ = try? runProcess(
          "/usr/bin/open", ["-a", Bundle.main.bundleURL.path, "--args", "--show-status"])
      }
    }
  } catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
  }
} else {
  ZenCompanionApp.main()
}
