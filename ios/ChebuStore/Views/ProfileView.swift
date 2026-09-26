import SwiftUI

struct ProfileView: View {
    @Environment(AuthStore.self) private var auth
    @State private var showLogin = false
    @State private var editing = false
    @State private var confirmLogout = false

    var body: some View {
        NavigationStack {
            Group {
                if let user = auth.user {
                    List {
                        Section {
                            Button { editing = true } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: "person.crop.circle.fill")
                                        .font(.system(size: 52))
                                        .foregroundStyle(.tertiary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(user.displayName).font(.title3.weight(.semibold))
                                        Text(user.phone ?? "Добавьте телефон").font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .foregroundStyle(.primary)
                        }

                        Section {
                            LabeledContent {
                                Text(user.telegramId == nil ? "Не привязан" : (user.telegramUsername.map { "@\($0)" } ?? "Привязан"))
                            } label: {
                                Label("Telegram", systemImage: "paperplane")
                            }
                            LabeledContent {
                                Text(user.email ?? "Не привязана")
                            } label: {
                                Label("Почта", systemImage: "envelope")
                            }
                        } header: {
                            Text("Способы входа")
                        } footer: {
                            Text("Привязать второй способ входа можно на сайте chebustore.ru в профиле.")
                        }

                        Section("Безопасность") {
                            NavigationLink { SessionsView() } label: { Label("Устройства и сеансы", systemImage: "lock.shield") }
                        }

                        if let cfg = auth.config, !cfg.supportTelegram.isEmpty || !cfg.supportEmail.isEmpty {
                            Section("Поддержка") {
                                if !cfg.supportTelegram.isEmpty, let url = URL(string: "https://t.me/\(cfg.supportTelegram.replacingOccurrences(of: "@", with: ""))") {
                                    Link(destination: url) { Label("Написать в Telegram", systemImage: "paperplane") }
                                }
                                if !cfg.supportEmail.isEmpty, let url = URL(string: "mailto:\(cfg.supportEmail)") {
                                    Link(destination: url) { Label(cfg.supportEmail, systemImage: "envelope") }
                                }
                            }
                        }

                        Section {
                            Button("Выйти", role: .destructive) { confirmLogout = true }.frame(maxWidth: .infinity)
                        }
                    }
                    .listStyle(.insetGrouped)
                    .sheet(isPresented: $editing) { EditProfileView(user: user) }
                    .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmLogout, titleVisibility: .visible) {
                        Button("Выйти", role: .destructive) { Task { await auth.logout() } }
                    }
                } else {
                    ContentUnavailableView {
                        Label("Вы не вошли", systemImage: "person")
                    } description: {
                        Text("Войдите через Telegram или почту, чтобы оформлять заказы и следить за ними.")
                    } actions: {
                        Button("Войти") { showLogin = true }.buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("Профиль")
            .sheet(isPresented: $showLogin) { LoginView() }
        }
    }
}

private struct EditProfileView: View {
    let user: User
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var phone = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Имя", text: $firstName).textContentType(.givenName)
                TextField("Фамилия", text: $lastName).textContentType(.familyName)
                TextField("Телефон", text: $phone).textContentType(.telephoneNumber).keyboardType(.phonePad)
            }
            .navigationTitle("Профиль")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") {
                        Task {
                            do {
                                try await auth.updateProfile(firstName: firstName, lastName: lastName, phone: phone)
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    }
                }
            }
            .onAppear {
                firstName = user.firstName ?? ""
                lastName = user.lastName ?? ""
                phone = user.phone ?? ""
            }
            .errorAlert($error)
        }
        .presentationDetents([.medium])
    }
}

struct SessionsView: View {
    @State private var sessions: [SessionInfo] = []
    @State private var error: String?

    var body: some View {
        List {
            Section {
                ForEach(sessions) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.title + (s.current ? " · это устройство" : ""))
                        Text("Активность \(Format.dateTime(s.lastSeenAt))\(s.ip.map { " · \($0)" } ?? "")")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .swipeActions {
                        if !s.current {
                            Button("Завершить", role: .destructive) { Task { await revoke(s.id) } }
                        }
                    }
                }
            } footer: {
                Text("Если видите незнакомое устройство — завершите его сеанс.")
            }
            if sessions.count > 1 {
                Section {
                    Button("Завершить все другие сеансы", role: .destructive) { Task { await revokeOthers() } }
                }
            }
        }
        .navigationTitle("Устройства")
        .task { await load() }
        .refreshable { await load() }
        .errorAlert($error)
    }

    private func load() async {
        do {
            let r: SessionsEnvelope = try await APIClient.shared.get("/account/sessions")
            sessions = r.sessions
        } catch { self.error = error.localizedDescription }
    }

    private func revoke(_ id: String) async {
        let _: OK? = try? await APIClient.shared.delete("/account/sessions/\(id)")
        await load()
    }

    private func revokeOthers() async {
        let _: OK? = try? await APIClient.shared.post("/account/sessions/revoke-others")
        await load()
    }
}
