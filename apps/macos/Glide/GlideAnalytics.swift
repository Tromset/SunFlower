import Foundation
import PostHog

enum GlideAnalytics {

    // Telemetry is opt-in and OFF by default. PostHog is never initialised,
    // and no event is ever captured, unless the user explicitly flips this
    // on (see the toggle in CompanionPanelView / CompanionManager). Every
    // capture call below re-checks `isEnabled` itself — not just `configure()`
    // — so flipping the setting off at runtime immediately stops all
    // reporting even if PostHog was already set up.
    private static let optInDefaultsKey = "analyticsOptIn"

    static var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: optInDefaultsKey)
    }

    private static var isConfigured = false


    static func configure() {
        guard isEnabled else { return }
        setUpPostHogIfNeeded()
    }



    static func updateOptIn(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: optInDefaultsKey)
        if enabled {
            setUpPostHogIfNeeded()
        } else if isConfigured {
            PostHogSDK.shared.optOut()
        }
    }

    private static func setUpPostHogIfNeeded() {
        guard !isConfigured else {
            PostHogSDK.shared.optIn()
            return
        }
        let config = PostHogConfig(
            apiKey: "phc_xcQPygmhTMzzYh8wNW92CCwoXmnzqyChAixh8zgpqC3C",
            host: "https://us.i.posthog.com"
        )
        PostHogSDK.shared.setup(config)
        isConfigured = true
    }




    static func trackAppOpened() {
        guard isEnabled else { return }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        PostHogSDK.shared.capture("app_opened", properties: [
            "app_version": version
        ])
    }




    static func trackOnboardingStarted() {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("onboarding_started")
    }


    static func trackOnboardingCompleted() {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("onboarding_completed")
    }


    static func trackOnboardingReplayed() {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("onboarding_replayed")
    }


    static func trackOnboardingDemoTriggered() {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("onboarding_demo_triggered")
    }




    static func trackAllPermissionsGranted() {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("all_permissions_granted")
    }


    static func trackPermissionGranted(permission: String) {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("permission_granted", properties: [
            "permission": permission
        ])
    }




    static func trackPushToTalkStarted() {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("push_to_talk_started")
    }


    static func trackPushToTalkReleased() {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("push_to_talk_released")
    }


    static func trackUserMessageSent(transcript: String) {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("user_message_sent", properties: [
            "transcript": transcript,
            "character_count": transcript.count
        ])
    }


    static func trackAIResponseReceived(response: String) {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("ai_response_received", properties: [
            "response": response,
            "character_count": response.count
        ])
    }



    static func trackElementPointed(elementLabel: String?) {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("element_pointed", properties: [
            "element_label": elementLabel ?? "unknown"
        ])
    }




    static func trackResponseError(error: String) {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("response_error", properties: [
            "error": error
        ])
    }


    static func trackTTSError(error: String) {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("tts_error", properties: [
            "error": error
        ])
    }
}
