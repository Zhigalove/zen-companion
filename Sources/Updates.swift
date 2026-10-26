import AppKit
import CryptoKit
import Foundation

struct SignedUpdate: Codable {
  var version: String
  var url: String
  var sha256: String
}
struct Envelope: Codable {
  var payload: String
  var signature: String
}
enum Updates {
  static let manifestURL = URL(
    string: "https://github.com/Zhigalove/zen-companion/releases/latest/download/update.json")!
  static func verify(_ data: Data, key: Data) throws -> SignedUpdate {
    let e = try JSONDecoder().decode(Envelope.self, from: data)
    guard let payload = Data(base64Encoded: e.payload),
      let signature = Data(base64Encoded: e.signature),
      try Curve25519.Signing.PublicKey(rawRepresentation: key).isValidSignature(
        signature, for: payload)
    else { throw UGError(message: "Подпись обновления не прошла проверку.") }
    let update = try JSONDecoder().decode(SignedUpdate.self, from: payload)
    guard update.url.hasPrefix("https://github.com/Zhigalove/zen-companion/releases/download/"),
      update.sha256.count == 64
    else { throw UGError(message: "Неверные данные обновления.") }
    return update
  }
  static func check() async throws -> SignedUpdate? {
    var request = URLRequest(url: manifestURL)
    request.timeoutInterval = 20
    request.cachePolicy = .reloadIgnoringLocalCacheData
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { return nil }
    if http.statusCode == 404 { return nil }
    guard http.statusCode == 200, data.count < 100_000 else {
      throw UGError(message: "Не удалось проверить обновления на GitHub.")
    }
    let key = Data(
      base64Encoded: text(Bundle.main.resourceURL!.appendingPathComponent("update-public-key.txt"))
        .trimmingCharacters(in: .whitespacesAndNewlines))!
    let u = try verify(data, key: key)
    let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    return u.version.compare(current, options: .numeric) == .orderedDescending ? u : nil
  }
  static func install(_ update: SignedUpdate, applyImprovements: Bool) async throws {
    var request = URLRequest(url: URL(string: update.url)!)
    request.timeoutInterval = 120
    let (file, response) = try await URLSession.shared.download(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      throw UGError(message: "Не удалось загрузить приложение.")
    }
    let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size > 0 && size < 100_000_000 else {
      throw UGError(message: "Неверный размер обновления.")
    }
    let data = try Data(contentsOf: file)
    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    guard hash == update.sha256 else {
      throw UGError(message: "Контрольная сумма обновления не совпала.")
    }
    let work = fm.temporaryDirectory.appendingPathComponent(
      "zen-companion-update-" + UUID().uuidString)
    try fm.createDirectory(at: work, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: work) }
    let (code, _) = try runProcess("/usr/bin/ditto", ["-x", "-k", file.path, work.path])
    guard code == 0 else { throw UGError(message: "Не удалось распаковать обновление.") }
    let source = work.appendingPathComponent("Zen Companion.app")
    let info =
      try PropertyListSerialization.propertyList(
        from: Data(contentsOf: source.appendingPathComponent("Contents/Info.plist")), format: nil)
      as? [String: Any]
    guard info?["CFBundleIdentifier"] as? String == "local.zen-companion.manager",
      info?["CFBundleShortVersionString"] as? String == update.version
    else { throw UGError(message: "В архиве находится другое приложение.") }
    let (signed, _) = try runProcess(
      "/usr/bin/codesign", ["--verify", "--deep", "--strict", source.path])
    guard signed == 0 else { throw UGError(message: "Повреждена подпись приложения.") }
    let destination = Bundle.main.bundleURL
    let old = destination.deletingLastPathComponent().appendingPathComponent(
      ".zen-companion-previous-" + UUID().uuidString + ".app")
    try fm.moveItem(at: destination, to: old)
    do {
      try fm.copyItem(at: source, to: destination)
      if applyImprovements {
        let (installed, output) = try runProcess(
          destination.appendingPathComponent("Contents/MacOS/ZenCompanion").path,
          ["--install", "--install-guard"])
        guard installed == 0 else { throw UGError(message: output) }
      }
      try? fm.removeItem(at: old)
    } catch {
      try? fm.removeItem(at: destination)
      try? fm.moveItem(at: old, to: destination)
      throw error
    }
  }
}
