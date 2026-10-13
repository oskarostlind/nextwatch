import UserNotifications

// Notification Service Extension: laddar ner bilden från push-payloadens "image"-nyckel
// och bifogar den så att notisen visar en förhandsbild (backdrop/poster).
// Körs i en egen process med ~30 s tak – därför kort nätverkstimeout och en garanti
// att contentHandler anropas exakt en gång, även om bilden saknas eller är trasig.
class NotificationService: UNNotificationServiceExtension {

    private let lock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?
    private var originalContent: UNNotificationContent?
    private var delivered = false
    private var session: URLSession?
    private var downloadTask: URLSessionDownloadTask?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        self.originalContent = request.content
        self.bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        // Ingen giltig https-bild → leverera notisen oförändrad.
        guard let urlString = request.content.userInfo["image"] as? String,
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https" else {
            finish(with: nil)
            return
        }

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 8
        let session = URLSession(configuration: config)
        self.session = session

        let task = session.downloadTask(with: url) { [weak self] tempURL, response, error in
            guard let self = self else { return }
            guard error == nil, let tempURL = tempURL else {
                self.finish(with: nil)
                return
            }
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                self.finish(with: nil)
                return
            }
            // tempURL raderas av systemet när den här closuren returnerar → flytta filen nu,
            // till ett unikt namn med rätt filändelse (annars avgör UserNotifications fel typ).
            let ext = NotificationService.fileExtension(mimeType: response?.mimeType, url: url)
            let target = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(ext)
            do {
                try FileManager.default.moveItem(at: tempURL, to: target)
                let attachment = try UNNotificationAttachment(identifier: "image", url: target, options: nil)
                self.finish(with: attachment)
            } catch {
                try? FileManager.default.removeItem(at: target)
                self.finish(with: nil)
            }
        }
        self.downloadTask = task
        task.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        // Tiden är slut → avbryt nedladdningen och leverera det vi har (utan bild).
        downloadTask?.cancel()
        finish(with: nil)
    }

    // Anropar contentHandler högst en gång (nedladdningen och timeWillExpire kan tävla).
    private func finish(with attachment: UNNotificationAttachment?) {
        lock.lock()
        defer { lock.unlock() }
        guard !delivered, let handler = contentHandler else { return }
        delivered = true
        if let content = bestAttemptContent {
            if let attachment = attachment {
                content.attachments = [attachment]
            }
            handler(content)
        } else if let original = originalContent {
            handler(original)
        } else {
            handler(UNMutableNotificationContent())
        }
        session?.finishTasksAndInvalidate()
    }

    private static func fileExtension(mimeType: String?, url: URL) -> String {
        switch mimeType?.lowercased() {
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/png": return "png"
        case "image/gif": return "gif"
        case "image/webp": return "webp"
        case "image/heic": return "heic"
        default: break
        }
        let fromURL = url.pathExtension.lowercased()
        return fromURL.isEmpty ? "jpg" : fromURL
    }
}
