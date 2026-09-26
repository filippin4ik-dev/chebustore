// swift ios/scripts/render-icon.swift ios/ChebuStore/Assets.xcassets/AppIcon.appiconset/AppIcon.png
import AppKit

let output = CommandLine.arguments.dropFirst().first ?? "AppIcon.png"
let size: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

NSColor.black.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()

let font = NSFont.systemFont(ofSize: 250, weight: .heavy)
let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: NSColor.white,
    .kern: 18,
    .paragraphStyle: paragraph,
]
let text = NSAttributedString(string: "ЧЕБУ", attributes: attrs)
let bounds = text.boundingRect(with: NSSize(width: size, height: size), options: [.usesLineFragmentOrigin])
text.draw(in: NSRect(x: 0, y: (size - bounds.height) / 2 + 10, width: size, height: bounds.height))

NSGraphicsContext.restoreGraphicsState()
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: output))
print("icon → \(output)")
