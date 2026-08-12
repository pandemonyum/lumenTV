import Capacitor
import Foundation
import UIKit

@objc(NativePlayerPlugin)
public final class NativePlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePlayerPlugin"
    public let jsName = "NativePlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    @objc public func open(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString), !urlString.isEmpty else {
            call.reject("url è obbligatorio", "invalid_url")
            return
        }
        guard let contentId = call.getString("contentId"), !contentId.isEmpty else {
            call.reject("contentId è obbligatorio", "invalid_content_id")
            return
        }

        let options = PremiumPlayerOptions(
            url: url,
            title: call.getString("title") ?? "LumenTV",
            contentId: contentId,
            contentType: call.getString("contentType") ?? "item",
            isLive: call.getBool("isLive") ?? false,
            startPositionSeconds: max(0, call.getDouble("startPositionSeconds") ?? 0),
            bufferSeconds: min(30, max(2, call.getInt("bufferSeconds") ?? 8))
        )

        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("Bridge iOS non disponibile", "bridge_unavailable")
                return
            }

            let playerController = PremiumPlayerViewController(options: options)
            playerController.modalPresentationStyle = .fullScreen
            playerController.onFinish = { result in
                call.resolve(result.asDictionary)
            }
            presenter.present(playerController, animated: true)
        }
    }
}
