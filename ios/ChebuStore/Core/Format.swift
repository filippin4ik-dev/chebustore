import Foundation

enum Format {
    private static let money: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = "\u{00A0}"
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 0
        return f
    }()

    static func rub(_ kopecks: Int) -> String {
        let value = Double(kopecks) / 100
        return "\(money.string(from: NSNumber(value: value)) ?? "\(value)")\u{00A0}₽"
    }

    static func rubles(_ kopecks: Int?) -> String {
        guard let kopecks else { return "" }
        return kopecks % 100 == 0 ? String(kopecks / 100) : String(format: "%.2f", Double(kopecks) / 100)
    }

    static func kopecks(_ rubles: String) -> Int? {
        let cleaned = rubles.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "")
        guard !cleaned.isEmpty, let v = Double(cleaned), v >= 0 else { return nil }
        return Int((v * 100).rounded())
    }

    static func date(_ d: Date) -> String {
        d.formatted(.dateTime.day().month(.wide).locale(Locale(identifier: "ru_RU")))
    }

    static func dateTime(_ d: Date) -> String {
        d.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(Locale(identifier: "ru_RU")))
    }

    static func timeLeft(_ d: Date) -> String {
        let s = Int(d.timeIntervalSinceNow)
        if s <= 0 { return "срок истёк" }
        let h = s / 3600, m = (s % 3600) / 60
        return h > 0 ? "\(h) ч \(m) мин" : "\(m) мин"
    }
}
