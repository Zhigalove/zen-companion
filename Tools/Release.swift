import CryptoKit
import Foundation

let a = CommandLine.arguments
if a.count < 4 {
  fatalError(
    "keygen <private-key> <public-key> | sign <private-key> <archive> <version> <manifest>")
}
let keyURL = URL(fileURLWithPath: a[2])
if a[1] == "keygen" {
  let dir = keyURL.deletingLastPathComponent()
  try FileManager.default.createDirectory(
    at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  let key: Curve25519.Signing.PrivateKey
  if FileManager.default.fileExists(atPath: keyURL.path) {
    key = try .init(rawRepresentation: Data(contentsOf: keyURL))
  } else {
    key = .init()
    try key.rawRepresentation.write(to: keyURL, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: keyURL.path)
  }
  try key.publicKey.rawRepresentation.base64EncodedString().write(
    toFile: a[3], atomically: true, encoding: .utf8)
  print("Public key ready; private key stays outside the repository.")
} else {
  let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(contentsOf: keyURL))
  let archive = try Data(contentsOf: URL(fileURLWithPath: a[3]))
  let version = a[4]
  let p: [String: String] = [
    "version": version,
    "url":
      "https://github.com/Zhigalove/zen-companion/releases/download/v\(version)/Zen-Companion-macOS-arm64.zip",
    "sha256": SHA256.hash(data: archive).map { String(format: "%02x", $0) }.joined(),
  ]
  let data = try JSONSerialization.data(withJSONObject: p, options: .sortedKeys)
  let env = [
    "payload": data.base64EncodedString(),
    "signature": try key.signature(for: data).base64EncodedString(),
  ]
  try JSONSerialization.data(withJSONObject: env, options: [.prettyPrinted, .sortedKeys]).write(
    to: URL(fileURLWithPath: a[5]), options: .atomic)
  print("Signed release manifest.")
}
