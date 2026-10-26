import AppKit

let destination = CommandLine.arguments[1]
let root = FileManager.default.temporaryDirectory.appendingPathComponent(
  UUID().uuidString + ".iconset")
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
for size in [16, 32, 64, 128, 256, 512, 1024] {
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(size)
  let box = NSRect(x: s * 0.07, y: s * 0.07, width: s * 0.86, height: s * 0.86)
  let path = NSBezierPath(roundedRect: box, xRadius: s * 0.20, yRadius: s * 0.20)
  NSGradient(
    starting: NSColor(calibratedRed: 0.25, green: 0.32, blue: 0.78, alpha: 1),
    ending: NSColor(calibratedRed: 0.13, green: 0.65, blue: 0.80, alpha: 1))!.draw(
      in: path, angle: 55)
  let symbol = (NSImage(systemSymbolName: "slider.horizontal.3", accessibilityDescription: nil)!)
    .withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [NSColor.white]))!
  symbol.draw(in: NSRect(x: s * 0.23, y: s * 0.23, width: s * 0.54, height: s * 0.54))
  NSGraphicsContext.restoreGraphicsState()
  let data = rep.representation(using: .png, properties: [:])!
  let names: [String]
  switch size {
  case 16: names = ["icon_16x16.png"]
  case 32: names = ["icon_16x16@2x.png", "icon_32x32.png"]
  case 64: names = ["icon_32x32@2x.png"]
  case 128: names = ["icon_128x128.png"]
  case 256: names = ["icon_128x128@2x.png", "icon_256x256.png"]
  case 512: names = ["icon_256x256@2x.png", "icon_512x512.png"]
  default: names = ["icon_512x512@2x.png"]
  }
  for n in names { try data.write(to: root.appendingPathComponent(n)) }
}
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", root.path, "-o", destination]
try p.run()
p.waitUntilExit()
if p.terminationStatus != 0 { exit(1) }
