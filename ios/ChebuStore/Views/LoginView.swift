import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var code = ""
    @State private var step: Step = .start
    @State private var busy = false
    @State private var error: String?
    @State private var resendIn = 0
    @FocusState private var codeFocused: Bool

    enum Step { case start, code }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        BrandLogo(size: 96)
                        Text("CHEBU").font(.title.weight(.bold))
                        Text("Панель управления магазином. Вход только для сотрудников.")
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                    .padding(.top, 24)

                    if step == .start {
                        Button {
                            Task { await telegram() }
                        } label: {
                            Label("Войти через Telegram", systemImage: "paperplane.fill")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(busy)

                        HStack {
                            Rectangle().fill(Color(.separator)).frame(height: 0.5)
                            Text("или по почте").font(.footnote).foregroundStyle(.secondary).fixedSize()
                            Rectangle().fill(Color(.separator)).frame(height: 0.5)
                        }

                        TextField("you@example.com", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(.horizontal, 14)
                            .frame(height: 50)
                            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .submitLabel(.continue)
                            .onSubmit { Task { await requestCode() } }

                        Button("Получить код") { Task { await requestCode() } }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(busy || !email.contains("@"))

                        Text("Пароль не нужен — пришлём одноразовый код.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Text("Код отправлен на \(email)").font(.subheadline)
                        TextField("••••••", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.center)
                            .font(.system(size: 28, weight: .semibold).monospacedDigit())
                            .tracking(10)
                            .frame(height: 56)
                            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .focused($codeFocused)
                            .onChange(of: code) { _, v in
                                let digits = String(v.filter(\.isNumber).prefix(6))
                                if digits != v { code = digits }
                                if digits.count == 6 { Task { await verify() } }
                            }
                        if busy { ProgressView() }
                        HStack {
                            Button("Другая почта") { step = .start }
                            Spacer()
                            Button(resendIn > 0 ? "Повторить через \(resendIn) с" : "Отправить снова") { Task { await requestCode() } }
                                .disabled(resendIn > 0 || busy)
                        }
                        .font(.subheadline)
                        .tint(.blue)
                    }
                }
                .padding(.horizontal, 20)
            }
            .background(Color(.systemGroupedBackground))
            .errorAlert($error)
            .task(id: resendIn) {
                guard resendIn > 0 else { return }
                try? await Task.sleep(for: .seconds(1))
                resendIn -= 1
            }
        }
    }

    private func telegram() async {
        busy = true
        defer { busy = false }
        do {
            try await auth.loginWithTelegram()
        } catch let e as APIError where e.code == "cancelled" {
        } catch {
            if (error as NSError).domain == "com.apple.AuthenticationServices.WebAuthenticationSession" { return }
            self.error = error.localizedDescription
        }
    }

    private func requestCode() async {
        busy = true
        defer { busy = false }
        do {
            resendIn = try await auth.requestCode(email: email.trimmingCharacters(in: .whitespaces).lowercased())
            step = .code
            code = ""
            codeFocused = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func verify() async {
        busy = true
        defer { busy = false }
        do {
            try await auth.verify(email: email.trimmingCharacters(in: .whitespaces).lowercased(), code: code)
        } catch {
            code = ""
            self.error = error.localizedDescription
        }
    }
}
