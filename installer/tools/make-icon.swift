// Renders the installer's app icon: the Apostle "A" on a near-black squircle,
// on Apple's macOS icon grid (824pt body inside a 1024 canvas).
// Usage: swift make-icon.swift <out.png>
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments[1]
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

let body = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: body, xRadius: 185, yRadius: 185)
NSGraphicsContext.current?.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
shadow.shadowOffset = NSSize(width: 0, height: -12)
shadow.shadowBlurRadius = 28
shadow.set()
NSColor(red: 0.043, green: 0.043, blue: 0.043, alpha: 1).setFill()
shape.fill()
NSGraphicsContext.current?.restoreGraphicsState()
// a hairline edge, like light catching the rim
NSColor(white: 1, alpha: 0.10).setStroke()
shape.lineWidth = 3
shape.stroke()

let font = NSFont(name: "HelveticaNeue-Bold", size: 520) ?? NSFont.boldSystemFont(ofSize: 520)
let a = NSAttributedString(string: "A", attributes: [.font: font, .foregroundColor: NSColor(red: 0.949, green: 0.949, blue: 0.941, alpha: 1)])
let aSize = a.size()
a.draw(at: NSPoint(x: (size - aSize.width) / 2, y: (size - aSize.height) / 2 - 10))
let reg = NSAttributedString(string: "®", attributes: [.font: NSFont(name: "HelveticaNeue", size: 64)!, .foregroundColor: NSColor(white: 0.95, alpha: 1)])
reg.draw(at: NSPoint(x: (size + aSize.width) / 2 + 6, y: (size + aSize.height) / 2 - 150))
// the panel's "linked" green, as a single dot
NSColor(red: 0.490, green: 0.847, blue: 0.490, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 712, y: 214, width: 44, height: 44)).fill()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
