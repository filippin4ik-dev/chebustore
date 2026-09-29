import SwiftUI

struct AdminBroadcastView: View {
    @State private var categories: [AdminCategory] = []
    @State private var text = "Привет, {имя}!\n\nВ магазине новое. Загляните, пока размеры не разобрали."
    @State private var segment = "all"
    @State private var categoryId = ""
    @State private var quietDays = 30
    @State private var includeStaff = false
    @State private var buttonKind = "shop"
    @State private var buttonLabel = ""
    @State private var buttonTarget = ""
    @State private var recipients: Int?
    @State private var error: String?
    @State private var saved = false
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                Picker("Кому", selection: $segment) {
                    Text("Все, кто открывал бота").tag("all")
                    Text("Кто уже заказывал").tag("buyers")
                    Text("Кто ещё не заказывал").tag("never")
                    Text("Давно не заказывали").tag("quiet")
                    Text("Покупали категорию").tag("category")
                }
                if segment == "quiet" {
                    Stepper("Не заказывали \(quietDays) дн.", value: $quietDays, in: 1...365)
                }
                if segment == "category" {
                    Picker("Категория", selection: $categoryId) {
                        Text("Выберите").tag("")
                        ForEach(categories) { c in Text(c.name).tag(c.id) }
                    }
                }
                Toggle("Включая сотрудников", isOn: $includeStaff)
                Button("Посчитать") { Task { await preview() } }.disabled(busy)
            } footer: {
                Text(recipients.map { "Получателей: \($0). Кто нажал «Не присылать» или заблокировал бота, не входит." } ?? "Посчитайте, сколько человек получит сообщение.")
            }

            Section {
                TextField("Текст", text: $text, axis: .vertical).lineLimit(4...10)
                Picker("Кнопка", selection: $buttonKind) {
                    Text("Магазин").tag("shop")
                    Text("Категория").tag("category")
                    Text("Товар").tag("product")
                    Text("Ссылка").tag("url")
                    Text("Без кнопки").tag("none")
                }
                if buttonKind != "none" {
                    TextField("Надпись кнопки", text: $buttonLabel)
                }
                if buttonKind == "category" {
                    Picker("Категория кнопки", selection: $buttonTarget) {
                        Text("Выберите").tag("")
                        ForEach(categories) { c in Text(c.name).tag(c.id) }
                    }
                }
                if buttonKind == "product" || buttonKind == "url" {
                    TextField(buttonKind == "url" ? "https://" : "slug товара", text: $buttonTarget).textInputAutocapitalization(.never)
                }
            } footer: {
                Text("{имя} и {ник} подставятся сами. Внизу будет кнопка «Не присылать». Фото можно добавить в рассылке на сайте.")
            }

            Section {
                Button("Проверить на себе") { Task { await send(test: true) } }.disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Отправить") { Task { await send(test: false) } }.disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .navigationTitle("Рассылка")
        .task {
            if let cats: AdminCategoriesEnvelope = try? await APIClient.shared.get("/admin/categories") {
                categories = cats.categories
            }
        }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: saved)
    }

    private var bodyPayload: [String: Any] {
        [
            "text": text.trimmingCharacters(in: .whitespacesAndNewlines),
            "photo": "",
            "buttonKind": buttonKind,
            "buttonLabel": buttonLabel,
            "buttonTarget": buttonTarget,
            "audience": [
                "segment": segment,
                "categoryId": categoryId,
                "quietDays": quietDays,
                "includeStaff": includeStaff,
            ],
        ]
    }

    private func preview() async {
        busy = true
        defer { busy = false }
        do {
            struct Result: Decodable { let recipients: Int }
            let r: Result = try await APIClient.shared.post("/admin/broadcasts/preview", ["audience": bodyPayload["audience"] as Any])
            recipients = r.recipients
        } catch { self.error = error.localizedDescription }
    }

    private func send(test: Bool) async {
        busy = true
        defer { busy = false }
        do {
            if test {
                let _: OK = try await APIClient.shared.post("/admin/broadcasts/test", bodyPayload)
            } else {
                let _: OK = try await APIClient.shared.post("/admin/broadcasts", bodyPayload)
            }
            saved.toggle()
        } catch { self.error = error.localizedDescription }
    }
}
