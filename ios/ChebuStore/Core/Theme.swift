import SwiftUI
import UIKit

extension UIColor {
    convenience init?(hex: String) {
        let s = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(
            red: CGFloat((v >> 16) & 0xFF) / 255,
            green: CGFloat((v >> 8) & 0xFF) / 255,
            blue: CGFloat(v & 0xFF) / 255,
            alpha: 1
        )
    }

    var luminance: CGFloat {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        let lin = { (c: CGFloat) in c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    var hexString: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        let c = { (v: CGFloat) in Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", c(r), c(g), c(b))
    }
}

extension Color {
    init(hex: String, fallback: Color = .primary) {
        if let ui = UIColor(hex: hex) { self.init(uiColor: ui) } else { self = fallback }
    }

    static func accent(_ theme: ThemeColors?) -> Color {
        guard let theme, let light = UIColor(hex: theme.accentLight), let dark = UIColor(hex: theme.accentDark) else {
            return .primary
        }
        return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }

    static func onAccent(_ theme: ThemeColors?) -> Color {
        guard let theme, let light = UIColor(hex: theme.accentLight), let dark = UIColor(hex: theme.accentDark) else {
            return Color(.systemBackground)
        }
        let on = { (c: UIColor) -> UIColor in c.luminance > 0.45 ? .black : .white }
        return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? on(dark) : on(light) })
    }

    var hexString: String { UIColor(self).hexString }
}

struct ThemePreset: Identifiable {
    let name: String
    let light: String
    let dark: String
    var id: String { name }

    static let all: [ThemePreset] = [
        .init(name: "Классика", light: "#000000", dark: "#FFFFFF"),
        .init(name: "Синий", light: "#007AFF", dark: "#0A84FF"),
        .init(name: "Индиго", light: "#5856D6", dark: "#7D7AFF"),
        .init(name: "Зелёный", light: "#248A3D", dark: "#30D158"),
        .init(name: "Бирюза", light: "#0A7E8C", dark: "#40C8E0"),
        .init(name: "Оранжевый", light: "#E0600B", dark: "#FF9F0A"),
        .init(name: "Красный", light: "#D70015", dark: "#FF453A"),
        .init(name: "Розовый", light: "#D30F57", dark: "#FF375F"),
        .init(name: "Графит", light: "#3A3A3C", dark: "#D1D1D6"),
    ]
}

struct BankAvatar: View {
    let bank: Bank
    var size: CGFloat = 28

    var body: some View {
        let scale: CGFloat = bank.short.count >= 4 ? 0.28 : bank.short.count == 3 ? 0.32 : bank.short.count == 2 ? 0.38 : 0.46
        Text(bank.short)
            .font(.system(size: size * scale, weight: .heavy))
            .foregroundStyle(Color(hex: bank.fg, fallback: .white))
            .frame(width: size, height: size)
            .background(Color(hex: bank.bg, fallback: .gray), in: Circle())
            .overlay(Circle().strokeBorder(.black.opacity(0.08), lineWidth: 0.5))
            .accessibilityHidden(true)
    }
}
