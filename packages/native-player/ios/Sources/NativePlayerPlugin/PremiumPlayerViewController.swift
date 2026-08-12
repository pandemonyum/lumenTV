import AVFoundation
import UIKit

struct PremiumPlayerOptions {
    let url: URL
    let title: String
    let contentId: String
    let contentType: String
    let isLive: Bool
    let startPositionSeconds: Double
    let bufferSeconds: Int
}

struct PremiumPlayerResult {
    let reason: String
    let positionSeconds: Double
    let durationSeconds: Double?
    let retryCount: Int
    let errorCode: String?
    let errorMessage: String?

    var asDictionary: [String: Any] {
        var value: [String: Any] = [
            "reason": reason,
            "positionSeconds": positionSeconds,
            "durationSeconds": durationSeconds ?? NSNull(),
            "retryCount": retryCount
        ]
        if let errorCode { value["errorCode"] = errorCode }
        if let errorMessage { value["errorMessage"] = errorMessage }
        return value
    }
}

private final class PlayerSurfaceView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    var playerLayer: AVPlayerLayer {
        guard let layer = layer as? AVPlayerLayer else {
            preconditionFailure("PlayerSurfaceView richiede AVPlayerLayer")
        }
        return layer
    }
}

private final class GradientView: UIView {
    override class var layerClass: AnyClass { CAGradientLayer.self }

    var gradientLayer: CAGradientLayer {
        guard let layer = layer as? CAGradientLayer else {
            preconditionFailure("GradientView richiede CAGradientLayer")
        }
        return layer
    }
}

@MainActor
final class PremiumPlayerViewController: UIViewController {
    var onFinish: ((PremiumPlayerResult) -> Void)?

    private let options: PremiumPlayerOptions
    private let surfaceView = PlayerSurfaceView()
    private let controlsView = UIView()
    private let topGradient = GradientView()
    private let bottomGradient = GradientView()
    private let centerStatusView = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    private let centerSpinner = UIActivityIndicatorView(style: .large)
    private let centerStatusLabel = UILabel()
    private let titleLabel = UILabel()
    private let stateLabel = UILabel()
    private let liveLabel = UILabel()
    private let positionLabel = UILabel()
    private let durationLabel = UILabel()
    private let seekSlider = UISlider()
    private let playButton = UIButton(type: .system)
    private let muteButton = UIButton(type: .system)
    private let retryButton = UIButton(type: .system)
    private let diagnosticsLabel = UILabel()

    private var player: AVPlayer?
    private var playerItem: AVPlayerItem?
    private var playerObservation: NSKeyValueObservation?
    private var itemStatusObservation: NSKeyValueObservation?
    private var keepUpObservation: NSKeyValueObservation?
    private var bufferEmptyObservation: NSKeyValueObservation?
    private var timeObserver: Any?
    private var notificationTokens: [NSObjectProtocol] = []
    private var stallTimer: Timer?
    private var controlsHideWorkItem: DispatchWorkItem?
    private var retryWorkItem: DispatchWorkItem?

    private var pendingStartPositionSeconds: Double = 0
    private var retryPositionSeconds: Double = 0
    private var lastAdvancedPositionSeconds: Double = 0
    private var lastAdvancedAt = Date()
    private var lastCheckpointAt = Date.distantPast
    private var stablePlaybackStartedAt: Date?
    private var controlsVisible = true
    private var userSeeking = false
    private var userPaused = false
    private var resumeAfterForeground = false
    private var retryScheduled = false
    private var resultSent = false
    private var consecutiveRetryCount = 0
    private var totalRetryCount = 0
    private var lastErrorCode: String?
    private var lastErrorMessage: String?

    private let stallTimeout: TimeInterval = 8
    private let stableResetInterval: TimeInterval = 10
    private let checkpointInterval: TimeInterval = 5

    init(options: PremiumPlayerOptions) {
        self.options = options
        super.init(nibName: nil, bundle: nil)
        modalPresentationCapturesStatusBarAppearance = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) non supportato")
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeRight }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureAudioSession()
        buildInterface()
        installApplicationObservers()

        let localCheckpoint = options.isLive ? 0 : UserDefaults.standard.double(forKey: checkpointPositionKey)
        pendingStartPositionSeconds = max(options.startPositionSeconds, localCheckpoint)
        lastAdvancedPositionSeconds = pendingStartPositionSeconds
        lastAdvancedAt = Date()
        createPlayer(startPositionSeconds: pendingStartPositionSeconds)
        startStallMonitor()
    }

    override func viewWillDisappear(_ animated: Bool) {
        saveCheckpoint()
        super.viewWillDisappear(animated)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
            try session.setActive(true)
        } catch {
            lastErrorCode = "audio_session"
            lastErrorMessage = error.localizedDescription
        }
    }

    private func buildInterface() {
        view.backgroundColor = .black
        surfaceView.translatesAutoresizingMaskIntoConstraints = false
        surfaceView.backgroundColor = .black
        surfaceView.playerLayer.videoGravity = .resizeAspect
        view.addSubview(surfaceView)
        NSLayoutConstraint.activate([
            surfaceView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            surfaceView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            surfaceView.topAnchor.constraint(equalTo: view.topAnchor),
            surfaceView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        controlsView.translatesAutoresizingMaskIntoConstraints = false
        controlsView.backgroundColor = .clear
        view.addSubview(controlsView)
        NSLayoutConstraint.activate([
            controlsView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controlsView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controlsView.topAnchor.constraint(equalTo: view.topAnchor),
            controlsView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        buildTopBar()
        buildCenterStatus()
        buildBottomControls()

        let tap = UITapGestureRecognizer(target: self, action: #selector(toggleControlsVisibility))
        tap.cancelsTouchesInView = false
        surfaceView.addGestureRecognizer(tap)
        surfaceView.isUserInteractionEnabled = true

        let controlsTap = UITapGestureRecognizer(target: self, action: #selector(controlsTapped))
        controlsTap.cancelsTouchesInView = false
        controlsView.addGestureRecognizer(controlsTap)
        showControls(animated: false)
    }

    private func buildTopBar() {
        topGradient.translatesAutoresizingMaskIntoConstraints = false
        topGradient.gradientLayer.colors = [UIColor.black.withAlphaComponent(0.92).cgColor, UIColor.clear.cgColor]
        topGradient.gradientLayer.startPoint = CGPoint(x: 0.5, y: 0)
        topGradient.gradientLayer.endPoint = CGPoint(x: 0.5, y: 1)
        controlsView.addSubview(topGradient)

        let closeButton = makeButton(title: "←", fontSize: 28, compact: true)
        closeButton.accessibilityLabel = "Chiudi player"
        closeButton.addTarget(self, action: #selector(closePressed), for: .touchUpInside)

        titleLabel.text = options.title
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 20, weight: .bold)
        titleLabel.numberOfLines = 1

        stateLabel.text = options.isLive ? "DIRETTA" : "VIDEO ON DEMAND"
        stateLabel.textColor = UIColor(white: 0.75, alpha: 1)
        stateLabel.font = .systemFont(ofSize: 12, weight: .semibold)

        let titleStack = UIStackView(arrangedSubviews: [titleLabel, stateLabel])
        titleStack.axis = .vertical
        titleStack.spacing = 3

        liveLabel.text = options.isLive ? "● LIVE" : options.contentType.uppercased()
        liveLabel.textColor = .white
        liveLabel.font = .systemFont(ofSize: 12, weight: .bold)
        liveLabel.textAlignment = .center
        liveLabel.backgroundColor = options.isLive ? UIColor(red: 0.87, green: 0.13, blue: 0.13, alpha: 1) : UIColor(white: 0.25, alpha: 0.8)
        liveLabel.layer.cornerRadius = 15
        liveLabel.layer.masksToBounds = true
        liveLabel.setContentHuggingPriority(.required, for: .horizontal)

        let row = UIStackView(arrangedSubviews: [closeButton, titleStack, liveLabel])
        row.translatesAutoresizingMaskIntoConstraints = false
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 16
        topGradient.addSubview(row)

        NSLayoutConstraint.activate([
            topGradient.leadingAnchor.constraint(equalTo: controlsView.leadingAnchor),
            topGradient.trailingAnchor.constraint(equalTo: controlsView.trailingAnchor),
            topGradient.topAnchor.constraint(equalTo: controlsView.topAnchor),
            topGradient.heightAnchor.constraint(equalToConstant: 118),
            row.leadingAnchor.constraint(equalTo: topGradient.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            row.trailingAnchor.constraint(equalTo: topGradient.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            row.topAnchor.constraint(equalTo: topGradient.safeAreaLayoutGuide.topAnchor, constant: 10),
            closeButton.widthAnchor.constraint(equalToConstant: 52),
            closeButton.heightAnchor.constraint(equalToConstant: 52),
            liveLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 78),
            liveLabel.heightAnchor.constraint(equalToConstant: 30)
        ])
    }

    private func buildCenterStatus() {
        centerStatusView.translatesAutoresizingMaskIntoConstraints = false
        centerStatusView.layer.cornerRadius = 16
        centerStatusView.layer.masksToBounds = true
        controlsView.addSubview(centerStatusView)

        centerSpinner.startAnimating()
        centerStatusLabel.text = "Caricamento"
        centerStatusLabel.textColor = .white
        centerStatusLabel.font = .systemFont(ofSize: 15, weight: .bold)
        centerStatusLabel.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [centerSpinner, centerStatusLabel])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10
        centerStatusView.contentView.addSubview(stack)

        NSLayoutConstraint.activate([
            centerStatusView.centerXAnchor.constraint(equalTo: controlsView.centerXAnchor),
            centerStatusView.centerYAnchor.constraint(equalTo: controlsView.centerYAnchor),
            centerStatusView.widthAnchor.constraint(greaterThanOrEqualToConstant: 190),
            centerStatusView.heightAnchor.constraint(greaterThanOrEqualToConstant: 112),
            stack.leadingAnchor.constraint(equalTo: centerStatusView.contentView.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: centerStatusView.contentView.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: centerStatusView.contentView.topAnchor, constant: 18),
            stack.bottomAnchor.constraint(equalTo: centerStatusView.contentView.bottomAnchor, constant: -18)
        ])
    }

    private func buildBottomControls() {
        bottomGradient.translatesAutoresizingMaskIntoConstraints = false
        bottomGradient.gradientLayer.colors = [UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.96).cgColor]
        bottomGradient.gradientLayer.startPoint = CGPoint(x: 0.5, y: 0)
        bottomGradient.gradientLayer.endPoint = CGPoint(x: 0.5, y: 1)
        controlsView.addSubview(bottomGradient)

        positionLabel.text = "0:00"
        positionLabel.textColor = .white
        positionLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        positionLabel.textAlignment = .center

        durationLabel.text = "--:--"
        durationLabel.textColor = .white
        durationLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        durationLabel.textAlignment = .center

        seekSlider.minimumValue = 0
        seekSlider.maximumValue = 1
        seekSlider.minimumTrackTintColor = UIColor(red: 1, green: 0.33, blue: 0.18, alpha: 1)
        seekSlider.maximumTrackTintColor = UIColor(white: 0.35, alpha: 0.8)
        seekSlider.addTarget(self, action: #selector(seekStarted), for: .touchDown)
        seekSlider.addTarget(self, action: #selector(seekChanged), for: .valueChanged)
        seekSlider.addTarget(self, action: #selector(seekEnded), for: [.touchUpInside, .touchUpOutside, .touchCancel])

        let timeline = UIStackView(arrangedSubviews: [positionLabel, seekSlider, durationLabel])
        timeline.axis = .horizontal
        timeline.alignment = .center
        timeline.spacing = 12
        timeline.isHidden = options.isLive
        positionLabel.widthAnchor.constraint(equalToConstant: 64).isActive = true
        durationLabel.widthAnchor.constraint(equalToConstant: 64).isActive = true

        configureActionButton(playButton, title: "❚❚")
        playButton.accessibilityLabel = "Play o pausa"
        playButton.addTarget(self, action: #selector(playPausePressed), for: .touchUpInside)

        configureActionButton(muteButton, title: "🔊")
        muteButton.accessibilityLabel = "Attiva o disattiva audio"
        muteButton.addTarget(self, action: #selector(mutePressed), for: .touchUpInside)

        configureActionButton(retryButton, title: "↻  Riprova")
        retryButton.accessibilityLabel = "Riconnetti il flusso"
        retryButton.addTarget(self, action: #selector(retryPressed), for: .touchUpInside)

        diagnosticsLabel.text = "Buffer \(options.bufferSeconds)s"
        diagnosticsLabel.textColor = UIColor(white: 0.74, alpha: 1)
        diagnosticsLabel.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        diagnosticsLabel.textAlignment = .right
        diagnosticsLabel.numberOfLines = 1

        let spacer = UIView()
        let actions = UIStackView(arrangedSubviews: [playButton, muteButton, retryButton, spacer, diagnosticsLabel])
        actions.axis = .horizontal
        actions.alignment = .center
        actions.spacing = 10
        diagnosticsLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 250).isActive = true

        let content = UIStackView(arrangedSubviews: [timeline, actions])
        content.translatesAutoresizingMaskIntoConstraints = false
        content.axis = .vertical
        content.spacing = 8
        bottomGradient.addSubview(content)

        NSLayoutConstraint.activate([
            bottomGradient.leadingAnchor.constraint(equalTo: controlsView.leadingAnchor),
            bottomGradient.trailingAnchor.constraint(equalTo: controlsView.trailingAnchor),
            bottomGradient.bottomAnchor.constraint(equalTo: controlsView.bottomAnchor),
            bottomGradient.heightAnchor.constraint(equalToConstant: options.isLive ? 150 : 188),
            content.leadingAnchor.constraint(equalTo: bottomGradient.safeAreaLayoutGuide.leadingAnchor, constant: 28),
            content.trailingAnchor.constraint(equalTo: bottomGradient.safeAreaLayoutGuide.trailingAnchor, constant: -28),
            content.bottomAnchor.constraint(equalTo: bottomGradient.safeAreaLayoutGuide.bottomAnchor, constant: -14),
            actions.heightAnchor.constraint(equalToConstant: 52)
        ])
    }

    private func createPlayer(startPositionSeconds: Double) {
        cleanupPlayerOnly()
        showCenterStatus(consecutiveRetryCount > 0 ? "Riconnessione" : "Caricamento")

        pendingStartPositionSeconds = options.isLive ? 0 : max(0, startPositionSeconds)
        let item = AVPlayerItem(url: options.url)
        item.preferredForwardBufferDuration = TimeInterval(options.bufferSeconds)
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true

        let nextPlayer = AVPlayer(playerItem: item)
        nextPlayer.automaticallyWaitsToMinimizeStalling = true
        nextPlayer.actionAtItemEnd = .pause
        nextPlayer.preventsDisplaySleepDuringVideoPlayback = true

        playerItem = item
        player = nextPlayer
        surfaceView.playerLayer.player = nextPlayer
        installPlayerObservers(player: nextPlayer, item: item)
        lastAdvancedAt = Date()
        lastAdvancedPositionSeconds = pendingStartPositionSeconds
        retryScheduled = false
    }

    private func installPlayerObservers(player: AVPlayer, item: AVPlayerItem) {
        itemStatusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] observedItem, _ in
            Task { @MainActor in
                guard let self else { return }
                switch observedItem.status {
                case .readyToPlay:
                    self.handleReadyToPlay()
                case .failed:
                    let error = observedItem.error as NSError?
                    self.scheduleRetry(
                        code: error.map { "\($0.domain).\($0.code)" } ?? "item_failed",
                        message: error?.localizedDescription ?? "AVPlayerItem non disponibile"
                    )
                case .unknown:
                    break
                @unknown default:
                    break
                }
            }
        }

        playerObservation = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] observedPlayer, _ in
            Task { @MainActor in
                guard let self else { return }
                switch observedPlayer.timeControlStatus {
                case .playing:
                    self.playButton.setTitle("❚❚", for: .normal)
                    self.stateLabel.text = self.options.isLive ? "DIRETTA" : "VIDEO ON DEMAND"
                    self.hideCenterStatus()
                    self.lastAdvancedAt = Date()
                    if self.stablePlaybackStartedAt == nil { self.stablePlaybackStartedAt = Date() }
                    self.scheduleControlsHide()
                case .paused:
                    self.playButton.setTitle("▶", for: .normal)
                case .waitingToPlayAtSpecifiedRate:
                    self.stateLabel.text = self.options.isLive ? "DIRETTA · BUFFERING" : "BUFFERING"
                    self.showCenterStatus("Buffering")
                @unknown default:
                    break
                }
            }
        }

        keepUpObservation = item.observe(\.isPlaybackLikelyToKeepUp, options: [.new]) { [weak self] observedItem, _ in
            Task { @MainActor in
                guard let self else { return }
                if observedItem.isPlaybackLikelyToKeepUp && self.player?.rate ?? 0 > 0 {
                    self.hideCenterStatus()
                }
            }
        }

        bufferEmptyObservation = item.observe(\.isPlaybackBufferEmpty, options: [.new]) { [weak self] observedItem, _ in
            Task { @MainActor in
                guard let self else { return }
                if observedItem.isPlaybackBufferEmpty {
                    self.showCenterStatus("Buffering")
                }
            }
        }

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            guard let self else { return }
            self.handlePeriodicTime(time.seconds)
        }

        notificationTokens.append(NotificationCenter.default.addObserver(
            forName: AVPlayerItem.playbackStalledNotification,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.showCenterStatus("Buffering")
        })

        notificationTokens.append(NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            if !self.options.isLive { self.clearCheckpoint() }
            self.finish(reason: "ended")
        })

        notificationTokens.append(NotificationCenter.default.addObserver(
            forName: AVPlayerItem.failedToPlayToEndTimeNotification,
            object: item,
            queue: .main
        ) { [weak self] notification in
            let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? NSError
            self?.scheduleRetry(
                code: error.map { "\($0.domain).\($0.code)" } ?? "failed_to_end",
                message: error?.localizedDescription ?? "Riproduzione interrotta"
            )
        })
    }

    private func handleReadyToPlay() {
        guard let player else { return }
        let start = pendingStartPositionSeconds
        if options.isLive || start <= 0 {
            player.play()
            return
        }

        let duration = usableDurationSeconds
        let safePosition = duration.map { min(start, max(0, $0 - 1)) } ?? start
        let time = CMTime(seconds: safePosition, preferredTimescale: 600)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak player] _ in
            Task { @MainActor in player?.play() }
        }
    }

    private func handlePeriodicTime(_ seconds: Double) {
        guard seconds.isFinite, seconds >= 0 else { return }
        if !userSeeking && !options.isLive {
            positionLabel.text = formatTime(seconds)
            if let duration = usableDurationSeconds {
                durationLabel.text = formatTime(duration)
                seekSlider.value = Float(min(1, max(0, seconds / duration)))
            }
        }

        if abs(seconds - lastAdvancedPositionSeconds) >= 0.08 {
            lastAdvancedPositionSeconds = seconds
            lastAdvancedAt = Date()
        }

        updateDiagnostics()
        if !options.isLive, Date().timeIntervalSince(lastCheckpointAt) >= checkpointInterval {
            saveCheckpoint()
            lastCheckpointAt = Date()
        }
    }

    private func startStallMonitor() {
        stallTimer?.invalidate()
        stallTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.monitorForStall() }
        }
    }

    private func monitorForStall() {
        guard let player, !retryScheduled, !userPaused, !userSeeking else { return }
        guard player.rate > 0 || player.timeControlStatus == .waitingToPlayAtSpecifiedRate else { return }

        if let stablePlaybackStartedAt, Date().timeIntervalSince(stablePlaybackStartedAt) >= stableResetInterval {
            consecutiveRetryCount = 0
            self.stablePlaybackStartedAt = nil
        }

        if Date().timeIntervalSince(lastAdvancedAt) >= stallTimeout {
            scheduleRetry(code: "stall_timeout", message: "Il clock video non avanza")
        }
    }

    private func scheduleRetry(code: String, message: String) {
        guard !resultSent, !retryScheduled else { return }
        retryScheduled = true
        totalRetryCount += 1
        consecutiveRetryCount += 1
        stablePlaybackStartedAt = nil
        lastErrorCode = code
        lastErrorMessage = message
        retryPositionSeconds = options.isLive ? 0 : currentPositionSeconds
        saveCheckpoint()

        let baseDelay: TimeInterval
        if consecutiveRetryCount <= 1 {
            baseDelay = 0
        } else {
            baseDelay = min(30, pow(2, Double(min(5, consecutiveRetryCount - 2))))
        }
        let jitter = baseDelay == 0 ? 0 : Double.random(in: 0...(baseDelay * 0.2))
        let delay = baseDelay + jitter

        stateLabel.text = "RICONNESSIONE"
        showCenterStatus("Riconnessione · tentativo \(totalRetryCount)")
        cleanupPlayerOnly()

        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.createPlayer(startPositionSeconds: self.retryPositionSeconds)
        }
        retryWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func updateDiagnostics() {
        guard let item = playerItem else { return }
        var bufferedAhead = 0.0
        let position = currentPositionSeconds
        if let range = item.loadedTimeRanges.last?.timeRangeValue {
            let end = CMTimeGetSeconds(CMTimeRangeGetEnd(range))
            if end.isFinite { bufferedAhead = max(0, end - position) }
        }
        let size = item.presentationSize
        let resolution = size.width > 0 ? "\(Int(size.width))×\(Int(size.height))" : "auto"
        diagnosticsLabel.text = String(
            format: "%@ · buffer %.1fs · retry %d",
            resolution,
            bufferedAhead,
            totalRetryCount
        )
    }

    @objc private func playPausePressed() {
        guard let player else { return }
        if player.timeControlStatus == .playing {
            userPaused = true
            player.pause()
        } else {
            userPaused = false
            lastAdvancedAt = Date()
            player.play()
        }
        showControls(animated: true)
    }

    @objc private func mutePressed() {
        guard let player else { return }
        player.isMuted.toggle()
        muteButton.setTitle(player.isMuted ? "🔇" : "🔊", for: .normal)
        scheduleControlsHide()
    }

    @objc private func retryPressed() {
        scheduleRetry(code: "manual_retry", message: "Retry manuale")
    }

    @objc private func closePressed() {
        finish(reason: "closed")
    }

    @objc private func seekStarted() {
        userSeeking = true
        controlsHideWorkItem?.cancel()
    }

    @objc private func seekChanged() {
        guard let duration = usableDurationSeconds else { return }
        positionLabel.text = formatTime(duration * Double(seekSlider.value))
    }

    @objc private func seekEnded() {
        defer {
            userSeeking = false
            scheduleControlsHide()
        }
        guard let player, let duration = usableDurationSeconds else { return }
        let target = duration * Double(seekSlider.value)
        player.seek(
            to: CMTime(seconds: target, preferredTimescale: 600),
            toleranceBefore: CMTime(seconds: 0.25, preferredTimescale: 600),
            toleranceAfter: CMTime(seconds: 0.25, preferredTimescale: 600)
        )
        lastAdvancedAt = Date()
    }

    @objc private func toggleControlsVisibility() {
        controlsVisible ? hideControls(animated: true) : showControls(animated: true)
    }

    @objc private func controlsTapped() {
        if controlsVisible { scheduleControlsHide() }
    }

    private func showCenterStatus(_ text: String) {
        controlsHideWorkItem?.cancel()
        controlsVisible = true
        controlsView.isHidden = false
        controlsView.alpha = 1
        centerStatusLabel.text = text
        centerSpinner.startAnimating()
        centerStatusView.isHidden = false
    }

    private func hideCenterStatus() {
        centerStatusView.isHidden = true
        centerSpinner.stopAnimating()
    }

    private func showControls(animated: Bool) {
        controlsHideWorkItem?.cancel()
        controlsVisible = true
        controlsView.isHidden = false
        let changes = { self.controlsView.alpha = 1 }
        if animated { UIView.animate(withDuration: 0.18, animations: changes) }
        else { changes() }
        scheduleControlsHide()
    }

    private func hideControls(animated: Bool) {
        guard centerStatusView.isHidden, !userSeeking else { return }
        controlsVisible = false
        let changes = { self.controlsView.alpha = 0 }
        let completion: (Bool) -> Void = { _ in
            if !self.controlsVisible { self.controlsView.isHidden = true }
        }
        if animated { UIView.animate(withDuration: 0.18, animations: changes, completion: completion) }
        else { changes(); completion(true) }
    }

    private func scheduleControlsHide() {
        controlsHideWorkItem?.cancel()
        guard player?.timeControlStatus == .playing, centerStatusView.isHidden, !userSeeking else { return }
        let work = DispatchWorkItem { [weak self] in self?.hideControls(animated: true) }
        controlsHideWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.5, execute: work)
    }

    private func saveCheckpoint() {
        guard !options.isLive else { return }
        let defaults = UserDefaults.standard
        defaults.set(currentPositionSeconds, forKey: checkpointPositionKey)
        if let duration = usableDurationSeconds { defaults.set(duration, forKey: checkpointDurationKey) }
        defaults.set(Date().timeIntervalSince1970, forKey: checkpointUpdatedKey)
    }

    private func clearCheckpoint() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: checkpointPositionKey)
        defaults.removeObject(forKey: checkpointDurationKey)
        defaults.removeObject(forKey: checkpointUpdatedKey)
    }

    private var checkpointPositionKey: String { "lumentv.checkpoint.\(options.contentId).position" }
    private var checkpointDurationKey: String { "lumentv.checkpoint.\(options.contentId).duration" }
    private var checkpointUpdatedKey: String { "lumentv.checkpoint.\(options.contentId).updated" }

    private var currentPositionSeconds: Double {
        guard let seconds = player?.currentTime().seconds, seconds.isFinite, seconds >= 0 else {
            return max(0, retryPositionSeconds)
        }
        return seconds
    }

    private var usableDurationSeconds: Double? {
        guard let seconds = playerItem?.duration.seconds, seconds.isFinite, seconds > 0 else { return nil }
        return seconds
    }

    private func installApplicationObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    @objc private func applicationDidEnterBackground() {
        saveCheckpoint()
        if player?.timeControlStatus == .playing {
            resumeAfterForeground = true
            player?.pause()
        }
    }

    @objc private func applicationWillEnterForeground() {
        guard resumeAfterForeground, !userPaused else { return }
        resumeAfterForeground = false
        lastAdvancedAt = Date()
        player?.play()
    }

    private func finish(reason: String) {
        guard !resultSent else { return }
        resultSent = true
        if !options.isLive, reason != "ended" { saveCheckpoint() }

        let result = PremiumPlayerResult(
            reason: reason,
            positionSeconds: currentPositionSeconds,
            durationSeconds: usableDurationSeconds,
            retryCount: totalRetryCount,
            errorCode: lastErrorCode,
            errorMessage: lastErrorMessage
        )
        cleanupAll()
        dismiss(animated: true) { [onFinish] in onFinish?(result) }
    }

    private func cleanupPlayerOnly() {
        retryWorkItem?.cancel()
        retryWorkItem = nil
        playerObservation?.invalidate()
        itemStatusObservation?.invalidate()
        keepUpObservation?.invalidate()
        bufferEmptyObservation?.invalidate()
        playerObservation = nil
        itemStatusObservation = nil
        keepUpObservation = nil
        bufferEmptyObservation = nil

        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        notificationTokens.forEach { NotificationCenter.default.removeObserver($0) }
        notificationTokens.removeAll()
        player?.pause()
        surfaceView.playerLayer.player = nil
        player = nil
        playerItem = nil
    }

    private func cleanupAll() {
        controlsHideWorkItem?.cancel()
        retryWorkItem?.cancel()
        stallTimer?.invalidate()
        stallTimer = nil
        cleanupPlayerOnly()
    }

    private func makeButton(title: String, fontSize: CGFloat, compact: Bool) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: fontSize, weight: .bold)
        button.backgroundColor = UIColor(white: 0.15, alpha: 0.72)
        button.layer.cornerRadius = compact ? 26 : 22
        button.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
        return button
    }

    private func configureActionButton(_ button: UIButton, title: String) {
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 14, weight: .bold)
        button.backgroundColor = UIColor(white: 0.16, alpha: 0.82)
        button.layer.cornerRadius = 22
        button.contentEdgeInsets = UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "--:--" }
        let total = Int(seconds.rounded(.down))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let remaining = total % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, remaining)
            : String(format: "%d:%02d", minutes, remaining)
    }
}
