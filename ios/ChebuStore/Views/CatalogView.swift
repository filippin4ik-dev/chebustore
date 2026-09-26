import SwiftUI

struct CatalogView: View {
    @Environment(AuthStore.self) private var auth
    @State private var categories: [Category] = []
    @State private var products: [Product] = []
    @State private var category: String?
    @State private var query = ""
    @State private var total = 0
    @State private var page = 1
    @State private var loading = false
    @State private var error: String?

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                if !categories.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            chip("Все", selected: category == nil) { category = nil }
                            ForEach(categories) { c in
                                chip(c.name, selected: category == c.slug) { category = c.slug }
                            }
                        }
                        .padding(.horizontal)
                    }
                    .padding(.vertical, 4)
                }

                if let error, products.isEmpty {
                    ContentUnavailableView {
                        Label("Не получилось загрузить", systemImage: "wifi.exclamationmark")
                    } description: { Text(error) } actions: {
                        Button("Повторить") { Task { await load(reset: true) } }
                    }
                    .padding(.top, 60)
                } else if !loading && products.isEmpty {
                    ContentUnavailableView.search(text: query).padding(.top, 60)
                } else {
                    LazyVGrid(columns: columns, spacing: 20) {
                        ForEach(products) { p in
                            NavigationLink(value: p) { ProductCard(product: p) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                    if products.count < total {
                        ProgressView()
                            .padding()
                            .task { await loadMore() }
                    }
                }
            }
            .navigationTitle(auth.config?.storeName ?? "ЧЕБУ STORE")
            .searchable(text: $query, prompt: "Поиск")
            .navigationDestination(for: Product.self) { ProductView(slug: $0.slug, preview: $0) }
            .refreshable { await load(reset: true) }
            .task { await loadCategories() }
            .task(id: "\(category ?? "")|\(query)") {
                try? await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 350))
                guard !Task.isCancelled else { return }
                await load(reset: true)
            }
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14)
                .frame(height: 34)
                .foregroundStyle(selected ? Color(.systemBackground) : .primary)
                .background(selected ? Color.primary : Color(.secondarySystemFill), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func loadCategories() async {
        if let r: CategoriesEnvelope = try? await APIClient.shared.get("/categories") { categories = r.categories }
    }

    private func path(page: Int) -> String {
        var comps = URLComponents()
        comps.queryItems = [URLQueryItem(name: "page", value: String(page))]
        if let category { comps.queryItems?.append(URLQueryItem(name: "category", value: category)) }
        if !query.isEmpty { comps.queryItems?.append(URLQueryItem(name: "q", value: query)) }
        return "/products?\(comps.percentEncodedQuery ?? "")"
    }

    private func load(reset: Bool) async {
        loading = true
        defer { loading = false }
        do {
            let r: ProductsEnvelope = try await APIClient.shared.get(path(page: 1))
            products = r.products
            total = r.total
            page = 1
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadMore() async {
        guard let r: ProductsEnvelope = try? await APIClient.shared.get(path(page: page + 1)) else { return }
        products += r.products
        page += 1
    }
}

struct ProductCard: View {
    let product: Product

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RemoteImage(path: product.images.first?.url)
                .aspectRatio(4 / 5, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if !product.available {
                        Text("Нет в наличии")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(.background, in: RoundedRectangle(cornerRadius: 6))
                            .padding(8)
                    }
                }
            Text(product.title).font(.subheadline).lineLimit(2).multilineTextAlignment(.leading)
            PriceText(price: product.price, oldPrice: product.oldPrice).font(.subheadline)
        }
    }
}
