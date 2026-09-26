import Foundation

enum AppConfig {
    static let baseURL = URL(string: "https://chebustore.ru")!
}

struct APIError: LocalizedError {
    let status: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
}

private struct ErrorEnvelope: Decodable {
    struct Body: Decodable { let code: String; let message: String }
    let error: Body
}

extension Notification.Name {
    static let sessionExpired = Notification.Name("chebustore.sessionExpired")
}

final class APIClient: @unchecked Sendable {
    static let shared = APIClient()
    private static let tokenAccount = "bearer"

    private let session: URLSession
    private let lock = NSLock()
    private var _token: String?

    private init() {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 30
        cfg.httpCookieAcceptPolicy = .never
        cfg.httpShouldSetCookies = false
        cfg.urlCache = nil
        session = URLSession(configuration: cfg)
        _token = Keychain.read(account: Self.tokenAccount)
    }

    var token: String? {
        get { lock.withLock { _token } }
        set {
            lock.withLock { _token = newValue }
            if let newValue { Keychain.save(newValue, account: Self.tokenAccount) } else { Keychain.delete(account: Self.tokenAccount) }
        }
    }

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: s) ?? plain.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(s)"))
        }
        return d
    }()

    func url(_ path: String) -> URL {
        URL(string: path, relativeTo: AppConfig.baseURL)!.absoluteURL
    }

    private func makeRequest(_ method: String, _ path: String) -> URLRequest {
        var req = URLRequest(url: url("/api" + path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError(status: 0, code: "network", message: "Нет соединения с сервером")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let env = try? Self.decoder.decode(ErrorEnvelope.self, from: data)
            if status == 401, token != nil {
                await MainActor.run { NotificationCenter.default.post(name: .sessionExpired, object: nil) }
            }
            throw APIError(status: status, code: env?.error.code ?? "http", message: env?.error.message ?? "Ошибка сервера (\(status))")
        }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw APIError(status: status, code: "decode", message: "Некорректный ответ сервера")
        }
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        try await perform(makeRequest("GET", path))
    }

    func send<T: Decodable>(_ method: String, _ path: String, _ body: [String: Any] = [:]) async throws -> T {
        var req = makeRequest(method, path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(req)
    }

    func post<T: Decodable>(_ path: String, _ body: [String: Any] = [:]) async throws -> T { try await send("POST", path, body) }
    func put<T: Decodable>(_ path: String, _ body: [String: Any] = [:]) async throws -> T { try await send("PUT", path, body) }
    func patch<T: Decodable>(_ path: String, _ body: [String: Any] = [:]) async throws -> T { try await send("PATCH", path, body) }
    func delete<T: Decodable>(_ path: String) async throws -> T { try await perform(makeRequest("DELETE", path)) }

    func upload<T: Decodable>(_ path: String, data fileData: Data, filename: String, mimeType: String) async throws -> T {
        var req = makeRequest("POST", path)
        let boundary = "cs-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".utf8))
        body.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(fileData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        req.httpBody = body
        req.timeoutInterval = 120
        return try await perform(req)
    }

    func download(_ path: String) async throws -> (Data, String) {
        let req = makeRequest("GET", path)
        let (data, response) = try await session.data(for: req)
        let http = response as? HTTPURLResponse
        guard let http, (200..<300).contains(http.statusCode) else {
            throw APIError(status: http?.statusCode ?? 0, code: "file", message: "Файл недоступен")
        }
        return (data, http.value(forHTTPHeaderField: "Content-Type") ?? "")
    }
}

struct OK: Decodable { let ok: Bool? }
