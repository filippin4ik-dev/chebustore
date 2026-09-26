import SwiftUI
import UIKit

struct RemoteImage: View {
    let path: String?
    var contentMode: ContentMode = .fill

    var body: some View {
        Rectangle()
            .fill(Color(.secondarySystemFill))
            .overlay {
                if let path {
                    AsyncImage(url: APIClient.shared.url(path), transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
                        switch phase {
                        case .success(let image): image.resizable().aspectRatio(contentMode: contentMode)
                        case .failure: Image(systemName: "photo").foregroundStyle(.tertiary)
                        default: EmptyView()
                        }
                    }
                } else {
                    Image(systemName: "photo").foregroundStyle(.tertiary)
                }
            }
            .clipped()
    }
}

/// Receipt image loaded with the bearer token (never cached on disk).
struct ProtectedImage: View {
    let path: String
    @State private var image: UIImage?
    @State private var isPDF = false
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 10))
            } else if isPDF {
                Label("PDF-квитанция", systemImage: "doc.richtext").foregroundStyle(.secondary)
            } else if failed {
                Text("Файл недоступен").font(.footnote).foregroundStyle(.secondary)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task(id: path) {
            do {
                let (data, type) = try await APIClient.shared.download(path)
                if type.contains("pdf") { isPDF = true } else { image = UIImage(data: data) }
                if image == nil && !isPDF { failed = true }
            } catch {
                failed = true
            }
        }
    }
}

struct StatusBadge: View {
    let status: OrderStatus
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(status.color).frame(width: 6, height: 6)
            Text(status.title)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(status.color)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(status.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
    }
}

struct PriceText: View {
    let price: Int
    var oldPrice: Int?
    var body: some View {
        HStack(spacing: 6) {
            Text(Format.rub(price)).fontWeight(.semibold).monospacedDigit()
            if let oldPrice, oldPrice > price {
                Text(Format.rub(oldPrice)).strikethrough().foregroundStyle(.secondary)
            }
        }
    }
}

struct CopyRow: View {
    let label: String
    let value: String
    var display: String?
    @State private var copied = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.footnote).foregroundStyle(.secondary)
                Text(display ?? value).monospacedDigit()
            }
            Spacer()
            Button(copied ? "Скопировано" : "Копировать") {
                UIPasteboard.general.string = value
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                copied = true
                Task {
                    try? await Task.sleep(for: .seconds(1.5))
                    copied = false
                }
            }
            .font(.subheadline)
            .buttonStyle(.borderless)
            .tint(.blue)
        }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var role: ButtonRole?
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(Color(.systemBackground))
            .background(Color.primary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(!isEnabled ? 0.35 : configuration.isPressed ? 0.7 : 1)
    }
}

extension View {
    func errorAlert(_ message: Binding<String?>) -> some View {
        alert("Ошибка", isPresented: Binding(get: { message.wrappedValue != nil }, set: { if !$0 { message.wrappedValue = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}
