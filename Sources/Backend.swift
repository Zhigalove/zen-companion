import AppKit
import Foundation

let modID = "e09b652e-7abc-47aa-94e0-91d5a35f625c"
let fm = FileManager.default
struct UGError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}
struct TestedZen: Codable {
  var version: String
  var bundleBuild: String
  var buildID: String
}
struct Compatibility: Codable {
  var schema: Int
  var packageVersion: String
  var appVersion: String
  var testedZen: [TestedZen]
  var repository: String
}
struct Preferences: Codable {
  var schema = 1
  var enabled = true
  var transparency = 40
  var appearance: String? = nil
  var revision = UUID().uuidString
  var testedZen: [TestedZen] = []
}
struct ManagerConfig: Codable {
  var profile: String
  var app: String
}
struct Report: Codable {
  var status: String
  var message: String
  var version: String?
  var restartRequired: Bool = false
}
func readJSON<T: Decodable>(_ type: T.Type, _ url: URL) throws -> T {
  try JSONDecoder().decode(type, from: Data(contentsOf: url))
}
func writeJSON<T: Encodable>(_ value: T, _ url: URL) throws {
  let e = JSONEncoder()
  e.outputFormatting = [.prettyPrinted, .sortedKeys]
  try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  try e.encode(value).write(to: url, options: .atomic)
}
func text(_ u: URL) -> String { (try? String(contentsOf: u, encoding: .utf8)) ?? "" }
func runProcess(_ program: String, _ arguments: [String]) throws -> (Int32, String) {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: program)
  p.arguments = arguments
  let output = Pipe()
  p.standardOutput = output
  p.standardError = output
  try p.run()
  let data = output.fileHandleForReading.readDataToEndOfFile()
  p.waitUntilExit()
  return (p.terminationStatus, String(decoding: data, as: UTF8.self))
}
final class Backend {
  let resources: URL, base: URL
  let serviceAllowed: Bool
  var config: ManagerConfig
  var profile: URL { URL(fileURLWithPath: config.profile) }
  var zen: URL { URL(fileURLWithPath: config.app) }
  var settingsURL: URL { profile.appendingPathComponent("ultimate-glass-settings.json") }
  var payload: URL { resources.appendingPathComponent("Payload") }
  var compatibility: Compatibility {
    get throws {
      try readJSON(Compatibility.self, resources.appendingPathComponent("compatibility.json"))
    }
  }
  init(
    resources: URL = Bundle.main.resourceURL!, base: URL? = nil, profile: URL? = nil,
    zen: URL? = nil
  ) throws {
    self.serviceAllowed = base == nil
    self.resources = resources
    self.base =
      base
      ?? fm.homeDirectoryForCurrentUser.appendingPathComponent(
        "Library/Application Support/Zen Companion")
    let old =
      (try? readJSON(ManagerConfig.self, self.base.appendingPathComponent("manager.json")))
      ?? (try? readJSON(
        ManagerConfig.self,
        fm.homeDirectoryForCurrentUser.appendingPathComponent(
          "Library/Application Support/Ultimate Glass/config.json")))
    let detected = Self.detectProfile()
    self.config = ManagerConfig(
      profile: profile?.path ?? old?.profile ?? detected?.path ?? "",
      app: zen?.path ?? old?.app ?? "/Applications/Zen.app")
  }
  static func detectProfile() -> URL? {
    let base = fm.homeDirectoryForCurrentUser.appendingPathComponent(
      "Library/Application Support/zen")
    let ini = text(base.appendingPathComponent("installs.ini"))
    let paths = Set(
      ini.components(separatedBy: .newlines).filter { $0.hasPrefix("Default=") }.map {
        String($0.dropFirst(8))
      })
    guard paths.count == 1, let p = paths.first else { return nil }
    return p.hasPrefix("/") ? URL(fileURLWithPath: p) : base.appendingPathComponent(p)
  }
  func validateProfile() throws {
    guard !config.profile.isEmpty,
      fm.fileExists(atPath: profile.appendingPathComponent("prefs.js").path)
    else { throw UGError(message: "Профиль Zen не найден. Выберите его в меню «Обслуживание».") }
  }
  func metadata() throws -> [String: Any] {
    guard
      let d = try PropertyListSerialization.propertyList(
        from: Data(contentsOf: zen.appendingPathComponent("Contents/Info.plist")), format: nil)
        as? [String: Any], d["CFBundleIdentifier"] as? String == "app.zen-browser.zen"
    else { throw UGError(message: "По выбранному пути не найден официальный Zen.") }
    return d
  }
  func check() throws -> Report {
    try validateProfile()
    let d = try metadata()
    let v = d["CFBundleShortVersionString"] as? String ?? ""
    let build = d["CFBundleVersion"] as? String ?? ""
    let ini = text(zen.appendingPathComponent("Contents/Resources/application.ini"))
    let buildID =
      ini.components(separatedBy: .newlines).first { $0.hasPrefix("BuildID=") }?.dropFirst(8) ?? ""
    guard
      try compatibility.testedZen.contains(where: {
        $0.version == v && $0.bundleBuild == build && $0.buildID == buildID
      })
    else {
      return Report(
        status: "blocked",
        message: "Zen \(v): совместимость ещё не подтверждена. Изменения не применяются.",
        version: v)
    }
    return Report(status: "compatible", message: "Zen \(v) поддерживается", version: v)
  }
  func preferences() -> Preferences {
    if let s = try? readJSON(Preferences.self, settingsURL) { return s }
    var s = Preferences()
    let p = text(profile.appendingPathComponent("prefs.js"))
    let pattern = "user_pref\\(\"mod\\.zenliquid\\.transparency\",\\s*\"(\\d+)%\"\\)"
    if let re = try? NSRegularExpression(pattern: pattern),
      let match = re.firstMatch(in: p, range: NSRange(p.startIndex..., in: p)),
      let r = Range(match.range(at: 1), in: p), let n = Int(p[r])
    {
      s.transparency = max(0, min(100, n))
    }
    return s
  }
  func savePreferences(_ value: Preferences) throws {
    try validateProfile()
    var s = value
    s.transparency = Int((Double(s.transparency) / 10).rounded()) * 10
    s.appearance = s.appearance == "universal" ? "universal" : "glass"
    s.revision = UUID().uuidString
    s.testedZen = try compatibility.testedZen
    try writeJSON(s, settingsURL)
    try writeJSON(config, base.appendingPathComponent("manager.json"))
  }
  var installed: Bool {
    fm.fileExists(
      atPath: profile.appendingPathComponent("chrome/ultimate-glass-video/AppSettings.sys.mjs").path
    )
  }
  func report() throws -> Report {
    let c = try check()
    if c.status == "blocked" { return c }
    if !installed {
      return Report(
        status: "not-installed", message: "Готово к установке · текущие настройки будут сохранены",
        version: c.version)
    }
    if let guardReport = try? readJSON(
      Report.self, base.appendingPathComponent("manager-status.json")),
      guardReport.status == "blocked" || guardReport.status == "permission",
      guardReport.version == c.version
    {
      return guardReport
    }
    let s = preferences()
    let ack =
      (try? JSONSerialization.jsonObject(
        with: Data(contentsOf: URL(fileURLWithPath: settingsURL.path + ".applied.json"))))
      as? [String: Any]
    if ack?["revision"] as? String == s.revision,
      ack?["bridgeVersion"] as? String == (try compatibility.appVersion)
    {
      return Report(
        status: "applied",
        message: s.enabled ? "Улучшения включены · настройки применены" : "Улучшения отключены",
        version: c.version)
    }
    if ack?["bridgeVersion"] as? String == (try compatibility.appVersion),
      let modified = try? settingsURL.resourceValues(forKeys: [.contentModificationDateKey])
        .contentModificationDate,
      Date().timeIntervalSince(modified) < 3
    {
      return Report(status: "applying", message: "Применяем настройки…", version: c.version)
    }
    return Report(
      status: "restart", message: "Полностью закройте Zen через ⌘Q и откройте снова",
      version: c.version, restartRequired: true)
  }
  func copy(_ src: URL, _ dst: URL) throws {
    try fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
    if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
    try fm.copyItem(at: src, to: dst)
  }
  func ownedPaths() -> [String] {
    [
      "chrome/zen-themes/" + modID, "chrome/zen-themes.css", "chrome/userContent.css",
      "chrome/ultimate-glass-video", "zen-themes.json", "user.js", "prefs.js",
      "ultimate-glass-settings.json",
    ]
  }
  func backup() throws -> URL {
    let b = base.appendingPathComponent(
      "backups/"
        + ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-") + "-"
        + UUID().uuidString.prefix(6))
    try fm.createDirectory(at: b, withIntermediateDirectories: true)
    var existed: [String] = []
    for name in ownedPaths() {
      let p = profile.appendingPathComponent(name)
      if fm.fileExists(atPath: p.path) {
        try copy(p, b.appendingPathComponent("profile/" + name))
        existed.append(name)
      }
    }
    for name in ["ultimate-video.cfg", "defaults/pref/ultimate-video.js"] {
      let p = zen.appendingPathComponent("Contents/Resources/" + name)
      if fm.fileExists(atPath: p.path) { try copy(p, b.appendingPathComponent("app/" + name)) }
    }
    try writeJSON(
      ["profile": config.profile, "app": config.app], b.appendingPathComponent("target.json"))
    try writeJSON(existed, b.appendingPathComponent("existed.json"))
    return b
  }
  func ownedLoader(_ p: URL) -> Bool {
    let s = text(p)
    return s.hasPrefix("// Ultimate Glass Video: profile-scoped companion bootstrap.")
      || s.hasPrefix("// Local Ultimate Glass video companion;")
  }
  func checkLoaderOwnership() throws {
    let res = zen.appendingPathComponent("Contents/Resources")
    for folder in ["defaults/pref", "defaults/preferences"] {
      for file
        in (try? fm.contentsOfDirectory(
          at: res.appendingPathComponent(folder), includingPropertiesForKeys: nil)) ?? []
      where file.pathExtension == "js" && file.lastPathComponent != "ultimate-video.js" {
        if text(file).contains("general.config.filename") {
          throw UGError(
            message:
              "Найден другой загрузчик скриптов: \(file.lastPathComponent). Он не будет перезаписан."
          )
        }
      }
    }
    for (target, source) in [
      ("ultimate-video.cfg", "ultimate-video.cfg"),
      ("defaults/pref/ultimate-video.js", "ultimate-video-prefs.js"),
    ] {
      let p = res.appendingPathComponent(target)
      if fm.fileExists(atPath: p.path), let a = try? Data(contentsOf: p),
        a != (try Data(contentsOf: payload.appendingPathComponent("video-companion/" + source))),
        !ownedLoader(p)
      {
        throw UGError(message: "Неизвестное содержимое \(target). Установка остановлена.")
      }
    }
  }
  func checkAPIs() throws {
    for (entry, markers) in [
      (
        "actors/TranslationsParent.sys.mjs",
        ["async getLangTags()", "async translate(", "restorePage()"]
      ),
      (
        "moz-src/toolkit/components/pictureinpicture/PictureInPicture.sys.mjs",
        ["async openPipWindow(", "async handlePictureInPictureRequest(", "win.setupPlayer("]
      ),
    ] {
      let (_, source) = try runProcess(
        "/usr/bin/unzip",
        ["-p", zen.appendingPathComponent("Contents/Resources/omni.ja").path, entry])
      guard markers.allSatisfy(source.contains) else {
        throw UGError(message: "Проверка совместимости не пройдена: \(entry)")
      }
    }
  }
  func rebuildThemes() throws {
    let u = profile.appendingPathComponent("zen-themes.json")
    let mods =
      (try JSONSerialization.jsonObject(with: Data(contentsOf: u))) as? [String: [String: Any]]
      ?? [:]
    var s = "/* Managed by Ultimate Glass */\n"
    for key in mods.keys.sorted() {
      guard let m = mods[key], m["enabled"] as? Bool != false, let id = m["id"] as? String else {
        continue
      }
      s +=
        "\n/* \(id) */\n"
        + text(profile.appendingPathComponent("chrome/zen-themes/\(id)/chrome.css"))
    }
    try s.write(
      to: profile.appendingPathComponent("chrome/zen-themes.css"), atomically: true, encoding: .utf8
    )
  }
  func install() throws {
    let c = try check()
    guard c.status != "blocked" else { throw UGError(message: c.message) }
    try checkLoaderOwnership()
    try checkAPIs()
    let b = try backup()
    let s = preferences()
    do {
      let dest = profile.appendingPathComponent("chrome/zen-themes/" + modID)
      for n in [
        "chrome.css", "content.css", "preferences.json", "readme.md", "LICENSE-Transparent-Zen.txt",
      ] { try copy(payload.appendingPathComponent(n), dest.appendingPathComponent(n)) }
      var meta =
        (try JSONSerialization.jsonObject(
          with: Data(contentsOf: payload.appendingPathComponent("theme.json")))) as! [String: Any]
      meta["preferences"] = dest.appendingPathComponent("preferences.json").absoluteString
      meta["style"] = dest.appendingPathComponent("chrome.css").absoluteString
      meta["readme"] = dest.appendingPathComponent("readme.md").absoluteString
      meta["enabled"] = true
      let modURL = profile.appendingPathComponent("zen-themes.json")
      var mods =
        (try? JSONSerialization.jsonObject(with: Data(contentsOf: modURL))) as? [String: Any] ?? [:]
      mods[modID] = meta
      try JSONSerialization.data(withJSONObject: mods, options: [.prettyPrinted, .sortedKeys])
        .write(to: modURL, options: .atomic)
      try copy(
        payload.appendingPathComponent("video-companion"),
        profile.appendingPathComponent("chrome/ultimate-glass-video"))
      let uc = profile.appendingPathComponent("chrome/userContent.css")
      let line = "@import url(\"zen-themes/\(modID)/content.css\");"
      if !text(uc).contains(line) {
        try (line + "\n" + text(uc)).write(to: uc, atomically: true, encoding: .utf8)
      }
      let uj = profile.appendingPathComponent("user.js")
      var user = text(uj)
      if !user.contains("toolkit.legacyUserProfileCustomizations.stylesheets") {
        user += "\nuser_pref(\"toolkit.legacyUserProfileCustomizations.stylesheets\", true);\n"
      }
      let material =
        (try JSONSerialization.jsonObject(
          with: Data(contentsOf: resources.appendingPathComponent("native-preferences.json"))))
        as! [String: Any]
      if !user.contains("BEGIN Ultimate Glass native") {
        user += "\n// BEGIN Ultimate Glass native macOS material\n"
        for k in material.keys.sorted() {
          let d = try JSONSerialization.data(withJSONObject: [material[k]!], options: [])
          let v = String(decoding: d, as: UTF8.self).dropFirst().dropLast()
          user += "user_pref(\"\(k)\", \(v));\n"
        }
        user += "// END Ultimate Glass native macOS material\n"
      }
      try user.write(to: uj, atomically: true, encoding: .utf8)
      try savePreferences(s)
      try rebuildThemes()
      try repairLoader()
      try saveInstalledPayload()
      try writeJSON(["path": b.path], base.appendingPathComponent("last-backup.json"))
      pruneBackups()
    } catch {
      try? restoreBackup(b)
      throw error
    }
  }
  func repairLoader() throws {
    for (target, source) in [
      ("ultimate-video.cfg", "ultimate-video.cfg"),
      ("defaults/pref/ultimate-video.js", "ultimate-video-prefs.js"),
    ] {
      let p = zen.appendingPathComponent("Contents/Resources/" + target)
      let data = try Data(contentsOf: payload.appendingPathComponent("video-companion/" + source))
      if (try? Data(contentsOf: p)) != data {
        try fm.createDirectory(at: p.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: p, options: .atomic)
      }
    }
  }
  func saveInstalledPayload() throws {
    try fm.createDirectory(at: base, withIntermediateDirectories: true)
    try writeJSON(config, base.appendingPathComponent("manager.json"))
  }
  func restoreBackup(_ b: URL) throws {
    let target = try readJSON([String: String].self, b.appendingPathComponent("target.json"))
    guard target["profile"] == config.profile, target["app"] == config.app else {
      throw UGError(message: "Резервная копия относится к другому профилю.")
    }
    let existed = try readJSON([String].self, b.appendingPathComponent("existed.json"))
    for name in ownedPaths() {
      let p = profile.appendingPathComponent(name)
      if existed.contains(name) {
        try copy(b.appendingPathComponent("profile/" + name), p)
      } else if fm.fileExists(atPath: p.path) {
        try fm.removeItem(at: p)
      }
    }
    for n in ["ultimate-video.cfg", "defaults/pref/ultimate-video.js"] {
      let p = zen.appendingPathComponent("Contents/Resources/" + n)
      let saved = b.appendingPathComponent("app/" + n)
      if fm.fileExists(atPath: saved.path) {
        try copy(saved, p)
      } else if fm.fileExists(atPath: p.path) {
        try fm.removeItem(at: p)
      }
    }
  }
  func pruneBackups() {
    let root = base.appendingPathComponent("backups")
    let dirs = ((try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [])
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
    let protected =
      (try? readJSON([String: String].self, base.appendingPathComponent("last-backup.json")))?[
        "path"]
    var excess = dirs.count - 10
    for d in dirs where excess > 0 && d.path != protected {
      try? fm.removeItem(at: d)
      excess -= 1
    }
  }
  func restoreLast() throws {
    guard
      !NSWorkspace.shared.runningApplications.contains(where: {
        $0.bundleIdentifier == "app.zen-browser.zen"
          && $0.bundleURL?.resolvingSymlinksInPath().path == zen.resolvingSymlinksInPath().path
      })
    else { throw UGError(message: "Перед восстановлением полностью закройте Zen через ⌘Q.") }
    let b = try readJSON([String: String].self, base.appendingPathComponent("last-backup.json"))
    guard let path = b["path"] else { return }
    try restoreBackup(URL(fileURLWithPath: path))
  }
  func installGuard() throws {
    guard serviceAllowed else { return }
    let binary = Bundle.main.executableURL!.path
    let agent = fm.homeDirectoryForCurrentUser.appendingPathComponent(
      "Library/LaunchAgents/local.zen-companion.manager.plist")
    let data: [String: Any] = [
      "Label": "local.zen-companion.manager", "ProgramArguments": [binary, "--guard"],
      "RunAtLoad": true, "StartInterval": 30, "ProcessType": "Background", "LowPriorityIO": true,
    ]
    try fm.createDirectory(at: agent.deletingLastPathComponent(), withIntermediateDirectories: true)
    try PropertyListSerialization.data(fromPropertyList: data, format: .xml, options: 0).write(
      to: agent, options: .atomic)
    _ = try? runProcess(
      "/bin/launchctl", ["bootout", "gui/\(getuid())/local.zen-companion.manager"])
    let (code, out) = try runProcess(
      "/bin/launchctl", ["bootstrap", "gui/\(getuid())", agent.path])
    guard code == 0 else { throw UGError(message: out) }
    // Retire the older permissive repair agent only after our strict agent starts.
    _ = try? runProcess(
      "/bin/launchctl", ["bootout", "gui/\(getuid())/local.ultimate-glass.update-guard"])
    try? fm.removeItem(
      at: fm.homeDirectoryForCurrentUser.appendingPathComponent(
        "Library/LaunchAgents/local.ultimate-glass.update-guard.plist"))
  }
  func guardOnce() throws -> Report {
    do { return try checkedGuard() } catch {
      let r = Report(
        status: (error as NSError).code == NSFileWriteNoPermissionError ? "permission" : "blocked",
        message: (error as NSError).code == NSFileWriteNoPermissionError
          ? "macOS не разрешила восстановить загрузчик. Разрешите Zen Companion управление приложениями."
          : error.localizedDescription,
        version: (try? metadata())?["CFBundleShortVersionString"] as? String)
      try writeJSON(r, base.appendingPathComponent("manager-status.json"))
      return r
    }
  }
  func checkedGuard() throws -> Report {
    let c = try check()
    if c.status == "blocked" {
      try writeJSON(c, base.appendingPathComponent("manager-status.json"))
      return c
    }
    if !fm.fileExists(
      atPath: profile.appendingPathComponent("chrome/ultimate-glass-video/VideoCompanion.sys.mjs")
        .path)
    {
      return try report()
    }
    try checkLoaderOwnership()
    let res = zen.appendingPathComponent("Contents/Resources")
    let cfg = payload.appendingPathComponent("video-companion/ultimate-video.cfg")
    let prefs = payload.appendingPathComponent("video-companion/ultimate-video-prefs.js")
    if (try? Data(contentsOf: res.appendingPathComponent("ultimate-video.cfg")))
      == (try Data(contentsOf: cfg)),
      (try? Data(contentsOf: res.appendingPathComponent("defaults/pref/ultimate-video.js")))
        == (try Data(contentsOf: prefs))
    {
      try writeJSON(
        Report(status: "healthy", message: "Проверка пройдена", version: c.version),
        base.appendingPathComponent("manager-status.json"))
      return try report()
    }
    let watched = [
      "Contents/Info.plist", "Contents/MacOS/zen", "Contents/Resources/omni.ja",
      "Contents/Resources/browser/omni.ja",
    ]
    var fingerprint = ""
    for name in watched {
      let u = zen.appendingPathComponent(name)
      guard fm.fileExists(atPath: u.path) else {
        return Report(status: "waiting", message: "Ожидание завершения обновления Zen")
      }
      let a = try fm.attributesOfItem(atPath: u.path)
      fingerprint += "\(name):\(a[.size] ?? 0):\(a[.modificationDate] ?? Date())|"
    }
    let marker = base.appendingPathComponent("candidate.json")
    let old = (try? readJSON([String: String].self, marker)) ?? [:]
    if old["fingerprint"] != fingerprint {
      try writeJSON(
        ["fingerprint": fingerprint, "since": String(Date().timeIntervalSince1970)], marker)
      return Report(status: "waiting", message: "Ожидание завершения обновления Zen")
    }
    guard
      Date().timeIntervalSince1970 - (Double(old["since"] ?? "") ?? Date().timeIntervalSince1970)
        > 20
    else { return Report(status: "waiting", message: "Ожидание завершения обновления Zen") }
    try checkAPIs()
    _ = try backup()
    try repairLoader()
    pruneBackups()
    let r = Report(
      status: "repaired", message: "Загрузчик восстановлен. Перезапустите Zen", version: c.version,
      restartRequired: true)
    try writeJSON(r, base.appendingPathComponent("manager-status.json"))
    return r
  }
}
extension Backend {
  func uninstall() throws {
    guard
      !NSWorkspace.shared.runningApplications.contains(where: {
        $0.bundleIdentifier == "app.zen-browser.zen"
          && $0.bundleURL?.resolvingSymlinksInPath().path == zen.resolvingSymlinksInPath().path
      })
    else { throw UGError(message: "Перед удалением полностью закройте Zen через ⌘Q.") }
    try validateProfile()
    let b = try backup()
    try writeJSON(["path": b.path], base.appendingPathComponent("last-backup.json"))
    let modURL = profile.appendingPathComponent("zen-themes.json")
    var mods =
      (try? JSONSerialization.jsonObject(with: Data(contentsOf: modURL))) as? [String: Any] ?? [:]
    mods.removeValue(forKey: modID)
    try JSONSerialization.data(withJSONObject: mods, options: [.prettyPrinted, .sortedKeys]).write(
      to: modURL, options: .atomic)
    for name in [
      "chrome/zen-themes/" + modID, "chrome/ultimate-glass-video", "ultimate-glass-settings.json",
      "ultimate-glass-settings.json.applied.json",
    ] {
      let p = profile.appendingPathComponent(name)
      if fm.fileExists(atPath: p.path) { try fm.removeItem(at: p) }
    }
    let uc = profile.appendingPathComponent("chrome/userContent.css")
    try text(uc).replacingOccurrences(
      of: "@import url(\"zen-themes/\(modID)/content.css\");", with: ""
    ).write(to: uc, atomically: true, encoding: .utf8)
    let uj = profile.appendingPathComponent("user.js")
    let re = try NSRegularExpression(
      pattern:
        "(?s)// BEGIN Ultimate Glass native macOS material.*?// END Ultimate Glass native macOS material\\n?"
    )
    let t = text(uj)
    try re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: "")
      .write(to: uj, atomically: true, encoding: .utf8)
    let native =
      (try JSONSerialization.jsonObject(
        with: Data(contentsOf: resources.appendingPathComponent("native-preferences.json"))))
      as! [String: Any]
    let prefs = profile.appendingPathComponent("prefs.js")
    var ps = text(prefs)
    for line in ps.components(separatedBy: .newlines) {
      if line.hasPrefix("user_pref(\"mod.zenliquid.")
        || native.keys.contains(where: { line.hasPrefix("user_pref(\"\($0)\",") })
      {
        ps = ps.replacingOccurrences(of: line + "\n", with: "")
      }
    }
    try ps.write(to: prefs, atomically: true, encoding: .utf8)
    try rebuildThemes()
    for n in ["ultimate-video.cfg", "defaults/pref/ultimate-video.js"] {
      let p = zen.appendingPathComponent("Contents/Resources/" + n)
      if ownedLoader(p) { try fm.removeItem(at: p) }
    }
    if serviceAllowed {
      _ = try? runProcess(
        "/bin/launchctl", ["bootout", "gui/\(getuid())/local.zen-companion.manager"])
      try? fm.removeItem(
        at: fm.homeDirectoryForCurrentUser.appendingPathComponent(
          "Library/LaunchAgents/local.zen-companion.manager.plist"))
    }
  }
}
