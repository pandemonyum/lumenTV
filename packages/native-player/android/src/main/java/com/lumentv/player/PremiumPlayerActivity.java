package com.lumentv.player;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import java.util.Locale;
import java.util.Random;

@UnstableApi
public final class PremiumPlayerActivity extends Activity implements Player.Listener {
    public static final String EXTRA_URL = "lumentv.url";
    public static final String EXTRA_TITLE = "lumentv.title";
    public static final String EXTRA_CONTENT_ID = "lumentv.contentId";
    public static final String EXTRA_CONTENT_TYPE = "lumentv.contentType";
    public static final String EXTRA_IS_LIVE = "lumentv.isLive";
    public static final String EXTRA_START_POSITION_MS = "lumentv.startPositionMs";
    public static final String EXTRA_BUFFER_SECONDS = "lumentv.bufferSeconds";

    public static final String RESULT_REASON = "lumentv.result.reason";
    public static final String RESULT_POSITION_MS = "lumentv.result.positionMs";
    public static final String RESULT_DURATION_MS = "lumentv.result.durationMs";
    public static final String RESULT_RETRY_COUNT = "lumentv.result.retryCount";
    public static final String RESULT_ERROR_CODE = "lumentv.result.errorCode";
    public static final String RESULT_ERROR_MESSAGE = "lumentv.result.errorMessage";

    private static final long STALL_TIMEOUT_MS = 8_000L;
    private static final long CHECKPOINT_INTERVAL_MS = 5_000L;
    private static final long CONTROLS_TIMEOUT_MS = 4_500L;
    private static final String PREFS_NAME = "lumentv.native.player";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Random random = new Random();

    private ExoPlayer player;
    private PlayerView playerView;
    private View controlsLayer;
    private LinearLayout centerStatus;
    private TextView centerStatusLabel;
    private TextView titleLabel;
    private TextView stateLabel;
    private TextView positionLabel;
    private TextView durationLabel;
    private TextView diagnosticsLabel;
    private SeekBar seekBar;
    private Button playButton;
    private Button muteButton;

    private String sourceUrl;
    private String title;
    private String contentId;
    private String contentType;
    private boolean isLive;
    private int bufferSeconds;
    private long initialPositionMs;
    private long retryPositionMs;
    private long lastAdvancedPositionMs;
    private long lastAdvancedAtMs;
    private long lastCheckpointAtMs;
    private long stablePlaybackStartedAtMs;
    private boolean controlsVisible = true;
    private boolean userSeeking = false;
    private boolean userPaused = false;
    private boolean resumeAfterForeground = false;
    private boolean retryScheduled = false;
    private boolean resultSent = false;
    private int consecutiveRetryCount = 0;
    private int totalRetryCount = 0;
    private String lastErrorCode;
    private String lastErrorMessage;

    private final Runnable hideControlsRunnable = () -> setControlsVisible(false);

    private final Runnable positionRunnable = new Runnable() {
        @Override
        public void run() {
            updatePlaybackUi();
            monitorForStall();
            saveCheckpointIfDue();
            mainHandler.postDelayed(this, 500L);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        readIntent();
        configureWindow();
        buildInterface();

        long localCheckpoint = isLive ? 0L : checkpointPreferences().getLong(checkpointPositionKey(), 0L);
        initialPositionMs = Math.max(initialPositionMs, localCheckpoint);
        lastAdvancedAtMs = now();
        createPlayer(initialPositionMs);
        mainHandler.post(positionRunnable);
    }

    private void readIntent() {
        Intent intent = getIntent();
        sourceUrl = valueOrEmpty(intent.getStringExtra(EXTRA_URL));
        title = valueOrDefault(intent.getStringExtra(EXTRA_TITLE), "LumenTV");
        contentId = valueOrDefault(intent.getStringExtra(EXTRA_CONTENT_ID), "unknown");
        contentType = valueOrDefault(intent.getStringExtra(EXTRA_CONTENT_TYPE), "item");
        isLive = intent.getBooleanExtra(EXTRA_IS_LIVE, false);
        initialPositionMs = Math.max(0L, intent.getLongExtra(EXTRA_START_POSITION_MS, 0L));
        bufferSeconds = Math.max(2, Math.min(30, intent.getIntExtra(EXTRA_BUFFER_SECONDS, 8)));

        if (sourceUrl.isEmpty()) {
            lastErrorCode = "invalid_url";
            lastErrorMessage = "URL video mancante";
        }
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.BLACK);
        window.setNavigationBarColor(Color.BLACK);
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    private void buildInterface() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setKeepScreenOn(true);

        playerView = new PlayerView(this);
        playerView.setUseController(false);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        playerView.setShutterBackgroundColor(Color.BLACK);
        playerView.setKeepScreenOn(true);
        root.addView(playerView, matchFrame());

        controlsLayer = buildControls();
        root.addView(controlsLayer, matchFrame());

        View.OnClickListener revealListener = view -> {
            if (controlsVisible) {
                scheduleControlsHide();
            } else {
                setControlsVisible(true);
            }
        };
        playerView.setOnClickListener(revealListener);

        setContentView(root);
        setControlsVisible(true);
    }

    private View buildControls() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.TRANSPARENT);

        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(24), dp(18), dp(24), dp(28));
        topBar.setBackground(verticalGradient(0xE6000000, 0x00000000));
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        );
        overlay.addView(topBar, topParams);

        Button closeButton = createRoundButton("←");
        closeButton.setContentDescription("Chiudi player");
        closeButton.setOnClickListener(view -> finishWithResult("closed"));
        topBar.addView(closeButton, new LinearLayout.LayoutParams(dp(52), dp(52)));

        LinearLayout titleBox = new LinearLayout(this);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        titleBox.setPadding(dp(16), 0, 0, 0);
        LinearLayout.LayoutParams titleBoxParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        topBar.addView(titleBox, titleBoxParams);

        titleLabel = createText(title, 20f, Color.WHITE, Typeface.BOLD);
        titleLabel.setMaxLines(1);
        titleBox.addView(titleLabel);

        stateLabel = createText(isLive ? "DIRETTA" : "VIDEO ON DEMAND", 12f, 0xFFB8BAC4, Typeface.BOLD);
        titleBox.addView(stateLabel);

        TextView livePill = createText(isLive ? "● LIVE" : contentType.toUpperCase(Locale.ROOT), 12f, Color.WHITE, Typeface.BOLD);
        livePill.setGravity(Gravity.CENTER);
        livePill.setPadding(dp(12), dp(6), dp(12), dp(6));
        livePill.setBackground(roundRect(isLive ? 0xFFDF2D2D : 0x99464A57, dp(18)));
        topBar.addView(livePill);

        centerStatus = new LinearLayout(this);
        centerStatus.setOrientation(LinearLayout.VERTICAL);
        centerStatus.setGravity(Gravity.CENTER);
        centerStatus.setPadding(dp(24), dp(20), dp(24), dp(20));
        centerStatus.setBackground(roundRect(0xB3000000, dp(16)));
        ProgressBar spinner = new ProgressBar(this);
        centerStatus.addView(spinner, new LinearLayout.LayoutParams(dp(48), dp(48)));
        centerStatusLabel = createText("Caricamento", 15f, Color.WHITE, Typeface.BOLD);
        centerStatusLabel.setPadding(0, dp(10), 0, 0);
        centerStatus.addView(centerStatusLabel);
        FrameLayout.LayoutParams centerParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        overlay.addView(centerStatus, centerParams);

        LinearLayout bottomPanel = new LinearLayout(this);
        bottomPanel.setOrientation(LinearLayout.VERTICAL);
        bottomPanel.setPadding(dp(28), dp(54), dp(28), dp(22));
        bottomPanel.setBackground(verticalGradient(0x00000000, 0xF0000000));
        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        overlay.addView(bottomPanel, bottomParams);

        LinearLayout timeline = new LinearLayout(this);
        timeline.setOrientation(LinearLayout.HORIZONTAL);
        timeline.setGravity(Gravity.CENTER_VERTICAL);
        timeline.setVisibility(isLive ? View.GONE : View.VISIBLE);
        bottomPanel.addView(timeline, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)));

        positionLabel = createText("0:00", 12f, 0xFFE7E7EA, Typeface.NORMAL);
        positionLabel.setGravity(Gravity.CENTER);
        timeline.addView(positionLabel, new LinearLayout.LayoutParams(dp(64), ViewGroup.LayoutParams.MATCH_PARENT));

        seekBar = new SeekBar(this);
        seekBar.setMax(1000);
        seekBar.setProgress(0);
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (!fromUser || player == null) return;
                long duration = usableDuration();
                if (duration > 0) {
                    positionLabel.setText(formatTime((duration * progress) / 1000L));
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {
                userSeeking = true;
                mainHandler.removeCallbacks(hideControlsRunnable);
            }

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
                if (player != null) {
                    long duration = usableDuration();
                    if (duration > 0) {
                        player.seekTo((duration * bar.getProgress()) / 1000L);
                        lastAdvancedAtMs = now();
                    }
                }
                userSeeking = false;
                scheduleControlsHide();
            }
        });
        timeline.addView(seekBar, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        durationLabel = createText("--:--", 12f, 0xFFE7E7EA, Typeface.NORMAL);
        durationLabel.setGravity(Gravity.CENTER);
        timeline.addView(durationLabel, new LinearLayout.LayoutParams(dp(64), ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        bottomPanel.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)));

        playButton = createActionButton("❚❚");
        playButton.setContentDescription("Play o pausa");
        playButton.setOnClickListener(view -> togglePlayback());
        actions.addView(playButton);

        muteButton = createActionButton("🔊");
        muteButton.setContentDescription("Attiva o disattiva audio");
        muteButton.setOnClickListener(view -> toggleMute());
        actions.addView(muteButton);

        Button retryButton = createActionButton("↻  Riprova");
        retryButton.setContentDescription("Riconnetti il flusso");
        retryButton.setOnClickListener(view -> hardRetry("manual_retry", "Retry manuale"));
        actions.addView(retryButton);

        diagnosticsLabel = createText("Buffer " + bufferSeconds + "s", 12f, 0xFFBABCC5, Typeface.NORMAL);
        diagnosticsLabel.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        actions.addView(diagnosticsLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        return overlay;
    }

    private void createPlayer(long startPositionMs) {
        if (sourceUrl.isEmpty()) {
            showFatalError("invalid_url", "URL video non valido");
            return;
        }

        releasePlayer();
        showCenterStatus(consecutiveRetryCount > 0 ? "Riconnessione" : "Caricamento");

        int targetMs = bufferSeconds * 1000;
        int minBufferMs = Math.max(2_500, targetMs);
        int maxBufferMs = Math.max(15_000, targetMs * 2);
        int playbackMs = Math.min(minBufferMs, Math.max(750, targetMs / 4));
        int rebufferMs = Math.min(minBufferMs, Math.max(1_500, targetMs / 2));

        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(minBufferMs, maxBufferMs, playbackMs, rebufferMs)
            .setBackBuffer(targetMs, true)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();

        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000)
            .setUserAgent("LumenTV/0.1 Android");

        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(this)
            .setDataSourceFactory(httpFactory);

        ExoPlayer nextPlayer = new ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(mediaSourceFactory)
            .build();
        nextPlayer.addListener(this);
        nextPlayer.setHandleAudioBecomingNoisy(true);
        nextPlayer.setRepeatMode(Player.REPEAT_MODE_OFF);
        MediaItem mediaItem = MediaItem.fromUri(Uri.parse(sourceUrl));
        if (isLive) {
            nextPlayer.setMediaItem(mediaItem);
        } else {
            nextPlayer.setMediaItem(mediaItem, Math.max(0L, startPositionMs));
        }
        nextPlayer.prepare();
        nextPlayer.setPlayWhenReady(true);

        player = nextPlayer;
        playerView.setPlayer(nextPlayer);
        retryScheduled = false;
        retryPositionMs = startPositionMs;
        lastAdvancedPositionMs = startPositionMs;
        lastAdvancedAtMs = now();
    }

    @Override
    public void onPlaybackStateChanged(int playbackState) {
        switch (playbackState) {
            case Player.STATE_BUFFERING:
                stateLabel.setText(isLive ? "DIRETTA · BUFFERING" : "BUFFERING");
                showCenterStatus("Buffering");
                break;
            case Player.STATE_READY:
                hideCenterStatus();
                stateLabel.setText(isLive ? "DIRETTA" : "VIDEO ON DEMAND");
                if (player != null && player.getPlayWhenReady()) {
                    playButton.setText("❚❚");
                }
                lastAdvancedAtMs = now();
                if (stablePlaybackStartedAtMs == 0L) stablePlaybackStartedAtMs = lastAdvancedAtMs;
                scheduleControlsHide();
                break;
            case Player.STATE_ENDED:
                if (!isLive) clearCheckpoint();
                finishWithResult("ended");
                break;
            case Player.STATE_IDLE:
            default:
                break;
        }
    }

    @Override
    public void onIsPlayingChanged(boolean isPlaying) {
        playButton.setText(isPlaying ? "❚❚" : "▶");
        if (isPlaying) {
            lastAdvancedAtMs = now();
            hideCenterStatus();
            scheduleControlsHide();
        }
    }

    @Override
    public void onPlayerError(PlaybackException error) {
        lastErrorCode = String.valueOf(error.errorCode);
        lastErrorMessage = error.getMessage();
        hardRetry(lastErrorCode, lastErrorMessage == null ? "Errore di riproduzione" : lastErrorMessage);
    }

    @Override
    public void onVideoSizeChanged(VideoSize videoSize) {
        updateDiagnostics();
    }

    private void hardRetry(String code, String message) {
        if (resultSent || retryScheduled) return;

        retryScheduled = true;
        totalRetryCount += 1;
        consecutiveRetryCount += 1;
        lastErrorCode = code;
        lastErrorMessage = message;
        retryPositionMs = isLive ? 0L : currentPosition();
        stablePlaybackStartedAtMs = 0L;
        saveCheckpoint();

        long baseDelay;
        if (consecutiveRetryCount <= 1) {
            baseDelay = 0L;
        } else {
            int exponent = Math.min(5, consecutiveRetryCount - 2);
            baseDelay = Math.min(30_000L, 1_000L * (1L << exponent));
        }
        long jitter = baseDelay == 0L ? 0L : random.nextInt((int) Math.max(1L, baseDelay / 5L));
        long delay = baseDelay + jitter;

        showCenterStatus("Riconnessione · tentativo " + totalRetryCount);
        stateLabel.setText("RICONNESSIONE");
        releasePlayer();
        mainHandler.postDelayed(() -> createPlayer(retryPositionMs), delay);
    }

    private void monitorForStall() {
        ExoPlayer currentPlayer = player;
        if (currentPlayer == null || retryScheduled || userPaused || userSeeking) return;
        if (!currentPlayer.getPlayWhenReady() || currentPlayer.getPlaybackState() == Player.STATE_ENDED) return;

        long currentNow = now();
        if (stablePlaybackStartedAtMs > 0L && currentNow - stablePlaybackStartedAtMs >= 10_000L) {
            consecutiveRetryCount = 0;
            stablePlaybackStartedAtMs = -1L;
        }

        long position = currentPlayer.getCurrentPosition();
        if (Math.abs(position - lastAdvancedPositionMs) >= 120L) {
            lastAdvancedPositionMs = position;
            lastAdvancedAtMs = currentNow;
            return;
        }

        if (currentNow - lastAdvancedAtMs >= STALL_TIMEOUT_MS) {
            hardRetry("stall_timeout", "Il clock video non avanza");
        }
    }

    private void updatePlaybackUi() {
        ExoPlayer currentPlayer = player;
        if (currentPlayer == null) return;

        long position = Math.max(0L, currentPlayer.getCurrentPosition());
        long duration = usableDuration();
        if (!userSeeking && !isLive) {
            positionLabel.setText(formatTime(position));
            durationLabel.setText(duration > 0L ? formatTime(duration) : "--:--");
            if (duration > 0L) {
                seekBar.setProgress((int) Math.min(1000L, (position * 1000L) / duration));
                int buffered = currentPlayer.getBufferedPercentage();
                seekBar.setSecondaryProgress(Math.max(0, Math.min(1000, buffered * 10)));
            }
        }
        updateDiagnostics();
    }

    private void updateDiagnostics() {
        ExoPlayer currentPlayer = player;
        if (currentPlayer == null || diagnosticsLabel == null) return;
        long bufferedMs = Math.max(0L, currentPlayer.getBufferedPosition() - currentPlayer.getCurrentPosition());
        VideoSize videoSize = currentPlayer.getVideoSize();
        String resolution = videoSize.width > 0 ? videoSize.width + "×" + videoSize.height : "auto";
        diagnosticsLabel.setText(
            String.format(Locale.ITALY, "%s · buffer %.1fs · retry %d", resolution, bufferedMs / 1000.0, totalRetryCount)
        );
    }

    private void togglePlayback() {
        ExoPlayer currentPlayer = player;
        if (currentPlayer == null) return;
        if (currentPlayer.isPlaying()) {
            userPaused = true;
            currentPlayer.pause();
        } else {
            userPaused = false;
            currentPlayer.play();
            lastAdvancedAtMs = now();
        }
        setControlsVisible(true);
    }

    private void toggleMute() {
        ExoPlayer currentPlayer = player;
        if (currentPlayer == null) return;
        boolean muted = currentPlayer.getVolume() <= 0.001f;
        currentPlayer.setVolume(muted ? 1f : 0f);
        muteButton.setText(muted ? "🔊" : "🔇");
        scheduleControlsHide();
    }

    private void showCenterStatus(String label) {
        if (centerStatus == null) return;
        controlsVisible = true;
        if (controlsLayer != null) {
            controlsLayer.setVisibility(View.VISIBLE);
            controlsLayer.setAlpha(1f);
        }
        centerStatusLabel.setText(label);
        centerStatus.setVisibility(View.VISIBLE);
        mainHandler.removeCallbacks(hideControlsRunnable);
    }

    private void hideCenterStatus() {
        if (centerStatus != null) centerStatus.setVisibility(View.GONE);
    }

    private void setControlsVisible(boolean visible) {
        controlsVisible = visible;
        if (controlsLayer != null) {
            controlsLayer.animate()
                .alpha(visible ? 1f : 0f)
                .setDuration(180L)
                .withStartAction(() -> controlsLayer.setVisibility(View.VISIBLE))
                .withEndAction(() -> {
                    if (!visible) controlsLayer.setVisibility(View.INVISIBLE);
                })
                .start();
        }
        if (visible) scheduleControlsHide();
        else mainHandler.removeCallbacks(hideControlsRunnable);
    }

    private void scheduleControlsHide() {
        mainHandler.removeCallbacks(hideControlsRunnable);
        if (!userSeeking && player != null && player.isPlaying()) {
            mainHandler.postDelayed(hideControlsRunnable, CONTROLS_TIMEOUT_MS);
        }
    }

    private void saveCheckpointIfDue() {
        if (isLive || player == null) return;
        long currentNow = now();
        if (currentNow - lastCheckpointAtMs >= CHECKPOINT_INTERVAL_MS) {
            saveCheckpoint();
            lastCheckpointAtMs = currentNow;
        }
    }

    private void saveCheckpoint() {
        if (isLive) return;
        long position = currentPosition();
        long duration = usableDuration();
        checkpointPreferences().edit()
            .putLong(checkpointPositionKey(), position)
            .putLong(checkpointDurationKey(), duration)
            .putLong(checkpointUpdatedKey(), System.currentTimeMillis())
            .apply();
    }

    private void clearCheckpoint() {
        checkpointPreferences().edit()
            .remove(checkpointPositionKey())
            .remove(checkpointDurationKey())
            .remove(checkpointUpdatedKey())
            .apply();
    }

    private SharedPreferences checkpointPreferences() {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private String checkpointPositionKey() {
        return "checkpoint." + contentId + ".position";
    }

    private String checkpointDurationKey() {
        return "checkpoint." + contentId + ".duration";
    }

    private String checkpointUpdatedKey() {
        return "checkpoint." + contentId + ".updated";
    }

    private long currentPosition() {
        return player == null ? Math.max(0L, retryPositionMs) : Math.max(0L, player.getCurrentPosition());
    }

    private long usableDuration() {
        if (player == null) return -1L;
        long duration = player.getDuration();
        return duration == C.TIME_UNSET || duration <= 0L ? -1L : duration;
    }

    private void showFatalError(String code, String message) {
        lastErrorCode = code;
        lastErrorMessage = message;
        showCenterStatus(message);
        stateLabel.setText("ERRORE");
        mainHandler.postDelayed(() -> finishWithResult("error"), 1_500L);
    }

    private void finishWithResult(String reason) {
        if (resultSent) return;
        resultSent = true;
        if (!isLive && !"ended".equals(reason)) saveCheckpoint();

        Intent data = new Intent();
        data.putExtra(RESULT_REASON, reason);
        data.putExtra(RESULT_POSITION_MS, currentPosition());
        data.putExtra(RESULT_DURATION_MS, usableDuration());
        data.putExtra(RESULT_RETRY_COUNT, totalRetryCount);
        if (lastErrorCode != null) data.putExtra(RESULT_ERROR_CODE, lastErrorCode);
        if (lastErrorMessage != null) data.putExtra(RESULT_ERROR_MESSAGE, lastErrorMessage);
        setResult("error".equals(reason) ? Activity.RESULT_CANCELED : Activity.RESULT_OK, data);
        finish();
    }

    private void releasePlayer() {
        ExoPlayer currentPlayer = player;
        player = null;
        if (playerView != null) playerView.setPlayer(null);
        if (currentPlayer != null) {
            currentPlayer.removeListener(this);
            currentPlayer.release();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        saveCheckpoint();
        if (!isFinishing() && player != null && player.isPlaying()) {
            resumeAfterForeground = true;
            player.pause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        configureWindow();
        if (resumeAfterForeground && !userPaused && player != null) {
            resumeAfterForeground = false;
            player.play();
            lastAdvancedAtMs = now();
        }
    }

    @Override
    public void onBackPressed() {
        finishWithResult("closed");
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        releasePlayer();
        super.onDestroy();
    }

    private FrameLayout.LayoutParams matchFrame() {
        return new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
    }

    private Button createRoundButton(String text) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(24f);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setBackground(roundRect(0x7A202126, dp(26)));
        return button;
    }

    private Button createActionButton(String text) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14f);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(14), 0, dp(14), 0);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setBackground(roundRect(0xA12A2C33, dp(22)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(44)
        );
        params.setMargins(0, 0, dp(10), 0);
        button.setLayoutParams(params);
        return button;
    }

    private TextView createText(String text, float sizeSp, int color, int style) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.create(Typeface.DEFAULT, style));
        view.setIncludeFontPadding(false);
        return view;
    }

    private GradientDrawable roundRect(int color, int radiusPx) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radiusPx);
        return drawable;
    }

    private GradientDrawable verticalGradient(int startColor, int endColor) {
        return new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { startColor, endColor }
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String formatTime(long milliseconds) {
        if (milliseconds < 0L) return "--:--";
        long totalSeconds = milliseconds / 1000L;
        long hours = totalSeconds / 3600L;
        long minutes = (totalSeconds % 3600L) / 60L;
        long seconds = totalSeconds % 60L;
        if (hours > 0L) {
            return String.format(Locale.ITALY, "%d:%02d:%02d", hours, minutes, seconds);
        }
        return String.format(Locale.ITALY, "%d:%02d", minutes, seconds);
    }

    private static long now() {
        return android.os.SystemClock.elapsedRealtime();
    }

    private static String valueOrEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    private static String valueOrDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }
}
