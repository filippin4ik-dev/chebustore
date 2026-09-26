import SwiftUI

struct ProductView: View {
    let slug: String
    var preview: Product?

    @Environment(AuthStore.self) private var auth
    @Environment(CartStore.self) private var cart
    @State private var product: Product?
    @State private var color: String?
    @State private var variantId: String?
    @State private var adding = false
    @State private var error: String?
    @State private var showLogin = false
    @State private var added = false

    var body: some View {
        let p = product ?? preview
        ScrollView {
            if let p {
                VStack(alignment: .leading, spacing: 20) {
                    gallery(p)
                    VStack(alignment: .leading, spacing: 6) {
                        if let c = p.category { Text(c.name).font(.footnote).foregroundStyle(.secondary) }
                        Text(p.title).font(.title2.weight(.bold))
                        PriceText(price: selected(p)?.price ?? p.price, oldPrice: p.oldPrice).font(.title3)
                    }
                    .padding(.horizontal)

                    let colors = colorsOf(p)
                    if colors.count > 1 {
                        optionGroup(title: "Цвет: \(activeColor(p))") {
                            ForEach(colors, id: \.self) { c in
                                OptionButton(title: c, selected: c == activeColor(p), enabled: true) {
                                    color = c
                                    variantId = nil
                                }
                            }
                        }
                    }

                    let sizes = sizesOf(p)
                    if !sizes.isEmpty {
                        optionGroup(title: selected(p)?.lowStock == true ? "Размер · осталось мало" : "Размер") {
                            ForEach(sizes) { v in
                                OptionButton(title: v.size, selected: v.id == variantId, enabled: v.available) {
                                    variantId = v.id
                                    UISelectionFeedbackGenerator().selectionChanged()
                                }
                            }
                        }
                    }

                    if !p.description.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Описание").font(.headline)
                            Text(p.description).font(.subheadline)
                        }
                        .padding(.horizontal)
                    }
                    Spacer(minLength: 100)
                }
            } else {
                ProgressView().padding(.top, 100)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if let p {
                Button {
                    Task { await add(p) }
                } label: {
                    if adding { ProgressView().tint(Color(.systemBackground)) } else { Text(buttonTitle(p)) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!p.available || adding)
                .padding(.horizontal)
                .padding(.vertical, 10)
                .background(.bar)
            }
        }
        .task { await load() }
        .sheet(isPresented: $showLogin) { LoginView() }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: added)
    }

    private func gallery(_ p: Product) -> some View {
        TabView {
            if p.images.isEmpty {
                RemoteImage(path: nil)
            }
            ForEach(p.images) { img in
                RemoteImage(path: img.url)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: p.images.count > 1 ? .automatic : .never))
        .aspectRatio(4 / 5, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal)
    }

    private func optionGroup<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.footnote).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) { content() }
            }
        }
        .padding(.horizontal)
    }

    private func colorsOf(_ p: Product) -> [String] {
        var seen = Set<String>()
        return p.variants.map(\.color).filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    private func activeColor(_ p: Product) -> String { color ?? colorsOf(p).first ?? "" }

    private func sizesOf(_ p: Product) -> [Variant] {
        let colors = colorsOf(p)
        return p.variants.filter { colors.isEmpty || $0.color == activeColor(p) }
    }

    private func selected(_ p: Product) -> Variant? { sizesOf(p).first { $0.id == variantId } }

    private func buttonTitle(_ p: Product) -> String {
        if !p.available { return "Нет в наличии" }
        if let v = selected(p) {
            let inCart = cart.quantity(of: v.id)
            return inCart > 0 ? "В корзине · \(inCart) — добавить ещё" : "В корзину · \(Format.rub(v.price))"
        }
        return "Выберите размер"
    }

    private func load() async {
        do {
            let r: ProductEnvelope = try await APIClient.shared.get("/products/\(slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug)")
            product = r.product
        } catch {
            if preview == nil { self.error = error.localizedDescription }
        }
    }

    private func add(_ p: Product) async {
        guard auth.user != nil else {
            showLogin = true
            return
        }
        guard let v = selected(p) else {
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            return
        }
        adding = true
        defer { adding = false }
        do {
            try await cart.setQuantity(variantId: v.id, quantity: cart.quantity(of: v.id) + 1)
            added.toggle()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct OptionButton: View {
    let title: String
    let selected: Bool
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.body.weight(.medium))
                .strikethrough(!enabled)
                .foregroundStyle(enabled ? .primary : .tertiary)
                .padding(.horizontal, 14)
                .frame(minWidth: 56, minHeight: 44)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(selected ? Color.primary : Color(.separator), lineWidth: selected ? 2 : 0.5)
                )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}
