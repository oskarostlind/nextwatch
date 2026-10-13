import UIKit
import UserNotifications

// Proxy framför Capacitors NotificationRouter (som är UNUserNotificationCenter-delegate).
//
// Varför: lock-screen-knapparna (❤️ Spara, 👎 Inte för mig, …) är bakgrundsåtgärder utan
// .foreground – appen öppnas inte och webbvyn kanske inte ens är laddad. Då måste knapptrycket
// POSTas direkt från native-koden. Allt annat (vanliga tryck, foreground-visning) skickas
// vidare oförändrat till Capacitor så att push-pluginets events och djuplänkar fungerar som förut.
//
// UNUserNotificationCenter.delegate är WEAK → proxyn hålls vid liv av `shared`.
final class PushActionDelegate: NSObject, UNUserNotificationCenterDelegate {

    static let shared = PushActionDelegate()

    // Capacitors router (eller vem som nu var delegate före oss). Weak: bryggan äger den.
    weak var inner: UNUserNotificationCenterDelegate?

    private static let endpoint = URL(string: "https://www.nextwatch.se/api/push/action")!

    // actionIdentifier → "action" i POST-bodyn (Contract 3).
    private static let backendActions: [String: String] = [
        "NW_SAVE": "save",
        "NW_NOPE": "nope",
        "NW_SEEN": "seen",
        "NW_REMOVE": "remove"
    ]

    private static let didReceiveSelector = #selector(
        UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))
    private static let willPresentSelector = #selector(
        UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))
    private static let openSettingsSelector = #selector(
        UNUserNotificationCenterDelegate.userNotificationCenter(_:openSettingsFor:))

    // Svar som kom innan Capacitors bridge hunnit laddas (kallstart via notistryck). De väntar här
    // tills install() hittar en inner-delegate – annars skulle djuplänken gå förlorad.
    private final class PendingResponse {
        let center: UNUserNotificationCenter
        let response: UNNotificationResponse
        var completion: (() -> Void)?
        init(center: UNUserNotificationCenter, response: UNNotificationResponse, completion: @escaping () -> Void) {
            self.center = center
            self.response = response
            self.completion = completion
        }
    }
    private var pending: [PendingResponse] = []

    // MARK: - Installation

    // Idempotent. Anropas från AppDelegate (kallstart i bakgrunden), från
    // NWBridgeViewController.capacitorDidLoad() (bridgen sätter då sin router som delegate)
    // och när appen blir aktiv (om något annat tagit över delegate-platsen).
    static func install() {
        let center = UNUserNotificationCenter.current()
        let current = center.delegate
        if current !== shared {
            if let current = current {
                shared.inner = current
            }
            center.delegate = shared
        }
        shared.flushPending()
    }

    // MARK: - Kategorier (lock-screen-knappar)

    static func registerCategories() {
        let swedish = Locale.preferredLanguages.first?.hasPrefix("sv") == true

        // Inga .foreground-options → åtgärden körs i bakgrunden och appen öppnas inte.
        let save = UNNotificationAction(identifier: "NW_SAVE",
                                        title: swedish ? "❤️ Spara" : "❤️ Save",
                                        options: [])
        let nope = UNNotificationAction(identifier: "NW_NOPE",
                                        title: swedish ? "👎 Inte för mig" : "👎 Not for me",
                                        options: [])
        let seen = UNNotificationAction(identifier: "NW_SEEN",
                                        title: swedish ? "✓ Har sett den" : "✓ Seen it",
                                        options: [])
        let remove = UNNotificationAction(identifier: "NW_REMOVE",
                                          title: swedish ? "Ta bort från listan" : "Remove from list",
                                          options: [.destructive])

        let title = UNNotificationCategory(identifier: "NW_TITLE",
                                           actions: [save, nope],
                                           intentIdentifiers: [],
                                           options: [])
        let saved = UNNotificationCategory(identifier: "NW_SAVED",
                                           actions: [seen, remove],
                                           intentIdentifiers: [],
                                           options: [])
        UNUserNotificationCenter.current().setNotificationCategories([title, saved])
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        onMain {
            if let inner = self.inner, inner.responds(to: PushActionDelegate.willPresentSelector) {
                inner.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
            } else {
                completionHandler([.banner, .list, .sound])
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        onMain {
            let userInfo = response.notification.request.content.userInfo
            if let action = PushActionDelegate.backendActions[response.actionIdentifier],
               let token = userInfo["act"] as? String, !token.isEmpty {
                self.perform(action: action, token: token, completion: completionHandler)
                return
            }
            self.forward(center: center, response: response, completion: completionHandler)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, openSettingsFor notification: UNNotification?) {
        onMain {
            if let inner = self.inner, inner.responds(to: PushActionDelegate.openSettingsSelector) {
                inner.userNotificationCenter?(center, openSettingsFor: notification)
            }
        }
    }

    // MARK: - Vidarebefordran

    private func forward(center: UNUserNotificationCenter,
                         response: UNNotificationResponse,
                         completion: @escaping () -> Void) {
        if let inner = inner {
            if inner.responds(to: PushActionDelegate.didReceiveSelector) {
                inner.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completion)
            } else {
                completion()
            }
            return
        }
        // Bridgen är inte laddad än → vänta på install(). Släpp efter 10 s så att vi aldrig
        // håller iOS completion-handler för länge.
        let item = PendingResponse(center: center, response: response, completion: completion)
        pending.append(item)
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self = self else { return }
            self.pending.removeAll { $0 === item }
            if let completion = item.completion {
                item.completion = nil
                completion()
            }
        }
    }

    private func flushPending() {
        guard let inner = inner, !pending.isEmpty else { return }
        let items = pending
        pending.removeAll()
        for item in items {
            guard let completion = item.completion else { continue }
            item.completion = nil
            if inner.responds(to: PushActionDelegate.didReceiveSelector) {
                inner.userNotificationCenter?(item.center, didReceive: item.response, withCompletionHandler: completion)
            } else {
                completion()
            }
        }
    }

    // MARK: - Bakgrunds-POST

    private func perform(action: String, token: String, completion: @escaping () -> Void) {
        // Håller processen vid liv medan nätverksanropet pågår; completion anropas exakt en gång.
        let job = BackgroundJob(completion: completion)

        var request = URLRequest(url: PushActionDelegate.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "action": action])

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 20
        let session = URLSession(configuration: config)
        let task = session.dataTask(with: request) { _, _, _ in
            session.finishTasksAndInvalidate()
            DispatchQueue.main.async { job.finish() }
        }
        task.resume()
    }

    private func onMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread {
            block()
        } else {
            DispatchQueue.main.async(execute: block)
        }
    }

    // Kapslar beginBackgroundTask/endBackgroundTask + completion-handlern så att båda alltid
    // körs en gång – även om iOS avbryter bakgrundstiden (expiration-handlern).
    private final class BackgroundJob {
        private var taskId: UIBackgroundTaskIdentifier = .invalid
        private var completion: (() -> Void)?

        init(completion: @escaping () -> Void) {
            self.completion = completion
            self.taskId = UIApplication.shared.beginBackgroundTask(withName: "nw.push.action") {
                self.finish()
            }
        }

        // Alltid på main-tråden.
        func finish() {
            if let completion = completion {
                self.completion = nil
                completion()
            }
            if taskId != .invalid {
                UIApplication.shared.endBackgroundTask(taskId)
                taskId = .invalid
            }
        }
    }
}
