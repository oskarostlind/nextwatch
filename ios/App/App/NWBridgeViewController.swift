import UIKit
import Capacitor

// Egen subklass av Capacitors view controller (Main.storyboard pekar hit).
// Varför: CapacitorBridge sätter sin NotificationRouter som UNUserNotificationCenter-delegate
// när bridgen skapas – efter AppDelegate.didFinishLaunching, och därmed över vår proxy.
// capacitorDidLoad() körs direkt efter att bridgen skapats, så här lindar vi in routern igen.
class NWBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        PushActionDelegate.install()
    }
}
