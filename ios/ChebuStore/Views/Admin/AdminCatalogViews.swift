import PhotosUI
import SwiftUI

struct AdminProductsView: View {
    @State private var products: [AdminProduct] = []
    @State private var query = ""
    @State private var loading = true

    private var filtered: [AdminProduct] {
        query.isEmpty ? products : products.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        List(filtered) { p in
            NavigationLink {
                AdminProductEditView(productId: p.id, onSaved: { Task { await load() } })
            } label: {
                HStack(spacing: 12) {
                    RemoteImage(path: p.images.first?.url).frame(width: 48, height: 60).clipShape(RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(p.title).lineLimit(2)
                        let stock = p.variants.filter(\.isActive).reduce(0) { $0 + $1.stock }
                        Text("\(Format.rub(p.basePrice)) · \(stock) шт. · \(p.variants.count) вар.")
                            .font(.subheadline)
                            .foregroundStyle(p.variants.contains { $0.isActive && $0.stock <= 2 } ? .orange : .secondary)
                        if !p.isActive { Text("Скрыт из каталога").font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if loading && products.isEmpty { ProgressView() }
            else if !loading && products.isEmpty { ContentUnavailableView("Товаров нет", systemImage: "tag") }
        }
        .navigationTitle("Товары")
        .searchable(text: $query)
        .toolbar {
            NavigationLink {
                AdminProductEditView(productId: nil, onSaved: { Task { await load() } })
            } label: {
                Image(systemName: "plus")
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        if let r: AdminProductsEnvelope = try? await APIClient.shared.get("/admin/products") { products = r.products }
    }
}

private struct VariantDraft: Identifiable, Hashable {
    let id = UUID()
    var serverId: String?
    var size: String
    var color: String
    var price: String
    var stock: Int
    var isActive: Bool
}

struct AdminProductEditView: View {
    @State var productId: String?
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var product: AdminProduct?
    @State private var categories: [AdminCategory] = []
    @State private var title = ""
    @State private var description = ""
    @State private var categoryId: String?
    @State private var price = ""
    @State private var oldPrice = ""
    @State private var isActive = true
    @State private var variants: [VariantDraft] = []
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var uploading = false
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false

    private let quickSizes = ["XS", "S", "M", "L", "XL", "XXL", "ONE SIZE"]

    var body: some View {
        Form {
            Section("Основное") {
                TextField("Название", text: $title)
                Picker("Категория", selection: $categoryId) {
                    Text("Без категории").tag(String?.none)
                    ForEach(categories) { Text($0.name).tag(Optional($0.id)) }
                }
                TextField("Цена, ₽", text: $price).keyboardType(.decimalPad)
                TextField("Старая цена (для скидки)", text: $oldPrice).keyboardType(.decimalPad)
                Toggle("Показывать в каталоге", isOn: $isActive)
            }

            Section("Описание") {
                TextField("Состав, посадка, уход", text: $description, axis: .vertical).lineLimit(3...10)
            }

            Section {
                if let product {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(product.images) { img in
                                RemoteImage(path: img.url)
                                    .frame(width: 88, height: 110)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                    .overlay(alignment: .topTrailing) {
                                        Button {
                                            Task { await deleteImage(img.id) }
                                        } label: {
                                            Image(systemName: "xmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.white, .black.opacity(0.6))
                                        }
                                        .padding(4)
                                    }
                            }
                            PhotosPicker(selection: $photoItems, maxSelectionCount: 10, matching: .images) {
                                VStack(spacing: 4) {
                                    if uploading { ProgressView() } else { Image(systemName: "plus") }
                                    Text("Фото").font(.caption)
                                }
                                .frame(width: 88, height: 110)
                                .foregroundStyle(.secondary)
                                .background(RoundedRectangle(cornerRadius: 10).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5])).foregroundStyle(.tertiary))
                            }
                            .disabled(uploading)
                        }
                        .padding(.vertical, 4)
                    }
                } else {
                    Text("Сохраните товар, чтобы добавить фото").foregroundStyle(.secondary)
                }
            } header: {
                Text("Фото")
            } footer: {
                Text("Первое фото — обложка. EXIF и геолокация удаляются на сервере.")
            }

            Section {
                ForEach($variants) { $v in
                    VStack(spacing: 8) {
                        HStack {
                            TextField("Размер", text: $v.size).fontWeight(.medium)
                            TextField("Цвет", text: $v.color).foregroundStyle(.secondary)
                            Toggle("", isOn: $v.isActive).labelsHidden()
                        }
                        HStack {
                            TextField("Цена (базовая)", text: $v.price).keyboardType(.decimalPad).font(.subheadline)
                            Stepper("Остаток: \(v.stock)", value: $v.stock, in: 0...100000).font(.subheadline)
                        }
                    }
                }
                .onDelete { variants.remove(atOffsets: $0) }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(quickSizes.filter { s in !variants.contains { $0.size == s } }, id: \.self) { s in
                            Button("+ \(s)") { addVariant(s) }.buttonStyle(.bordered).controlSize(.small)
                        }
                        Button("+ Свой") { addVariant("") }.buttonStyle(.bordered).controlSize(.small)
                    }
                }
            } header: {
                Text("Размеры и остатки")
            } footer: {
                Text("Смахните влево, чтобы удалить вариант.")
            }

            if product != nil {
                Section {
                    Button("Удалить товар", role: .destructive) { confirmDelete = true }.frame(maxWidth: .infinity)
                }
            }
        }
        .navigationTitle(productId == nil ? "Новый товар" : "Товар")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if saving { ProgressView() } else { Button("Сохранить") { Task { await save() } } }
            }
        }
        .task { await load() }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await upload(items) }
        }
        .confirmationDialog("Удалить товар навсегда? Лучше скрыть, если он есть в заказах.", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { Task { await deleteProduct() } }
        }
        .errorAlert($error)
    }

    private func addVariant(_ size: String) {
        variants.append(VariantDraft(serverId: nil, size: size, color: variants.last?.color ?? "", price: "", stock: 0, isActive: true))
    }

    private func fill(_ p: AdminProduct) {
        product = p
        productId = p.id
        title = p.title
        description = p.description
        categoryId = p.categoryId
        price = Format.rubles(p.basePrice)
        oldPrice = Format.rubles(p.oldPrice)
        isActive = p.isActive
        variants = p.variants.map {
            VariantDraft(serverId: $0.id, size: $0.size, color: $0.color, price: Format.rubles($0.price), stock: $0.stock, isActive: $0.isActive)
        }
    }

    private func load() async {
        if let r: AdminCategoriesEnvelope = try? await APIClient.shared.get("/admin/categories") { categories = r.categories }
        guard let productId, product == nil else { return }
        do {
            let r: AdminProductEnvelope = try await APIClient.shared.get("/admin/products/\(productId)")
            fill(r.product)
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Укажите название"; return }
        guard let base = Format.kopecks(price), base > 0 else { error = "Укажите цену"; return }
        saving = true
        defer { saving = false }
        do {
            let body: [String: Any] = [
                "title": title.trimmingCharacters(in: .whitespaces),
                "description": description,
                "categoryId": categoryId ?? NSNull(),
                "basePrice": base,
                "oldPrice": Format.kopecks(oldPrice) ?? NSNull(),
                "isActive": isActive,
            ]
            let saved: AdminProductEnvelope = productId == nil
                ? try await APIClient.shared.post("/admin/products", body)
                : try await APIClient.shared.patch("/admin/products/\(productId!)", body)
            let payload: [[String: Any]] = variants.filter { !$0.size.trimmingCharacters(in: .whitespaces).isEmpty }.map { v in
                var d: [String: Any] = [
                    "size": v.size.trimmingCharacters(in: .whitespaces),
                    "color": v.color.trimmingCharacters(in: .whitespaces),
                    "price": Format.kopecks(v.price) ?? NSNull(),
                    "stock": v.stock,
                    "isActive": v.isActive,
                ]
                if let id = v.serverId { d["id"] = id }
                return d
            }
            let withVariants: AdminProductEnvelope = try await APIClient.shared.put("/admin/products/\(saved.product.id)/variants", ["variants": payload])
            fill(withVariants.product)
            onSaved()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch { self.error = error.localizedDescription }
    }

    private func upload(_ items: [PhotosPickerItem]) async {
        guard let productId else { return }
        uploading = true
        defer {
            uploading = false
            photoItems = []
        }
        for item in items {
            do {
                guard let data = try await item.loadTransferable(type: Data.self),
                      let image = UIImage(data: data),
                      let jpeg = image.jpegData(compressionQuality: 0.9) else { continue }
                let r: AdminProductEnvelope = try await APIClient.shared.upload("/admin/products/\(productId)/images", data: jpeg, filename: "photo.jpg", mimeType: "image/jpeg")
                product = r.product
            } catch {
                self.error = error.localizedDescription
                return
            }
        }
        onSaved()
    }

    private func deleteImage(_ imageId: String) async {
        guard let productId else { return }
        do {
            let r: AdminProductEnvelope = try await APIClient.shared.delete("/admin/products/\(productId)/images/\(imageId)")
            product = r.product
        } catch { self.error = error.localizedDescription }
    }

    private func deleteProduct() async {
        guard let productId else { return }
        do {
            let _: OK = try await APIClient.shared.delete("/admin/products/\(productId)")
            onSaved()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
