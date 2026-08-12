package com.lumentv.player;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "LumenTV");
        String contentId = call.getString("contentId");
        String contentType = call.getString("contentType", "item");
        Boolean isLive = call.getBoolean("isLive", false);
        Double startPositionSeconds = call.getDouble("startPositionSeconds", 0.0);
        Integer bufferSeconds = call.getInt("bufferSeconds", 8);

        if (url == null || url.trim().isEmpty()) {
            call.reject("url è obbligatorio", "invalid_url");
            return;
        }
        if (contentId == null || contentId.trim().isEmpty()) {
            call.reject("contentId è obbligatorio", "invalid_content_id");
            return;
        }

        Intent intent = new Intent(getContext(), PremiumPlayerActivity.class);
        intent.putExtra(PremiumPlayerActivity.EXTRA_URL, url);
        intent.putExtra(PremiumPlayerActivity.EXTRA_TITLE, title);
        intent.putExtra(PremiumPlayerActivity.EXTRA_CONTENT_ID, contentId);
        intent.putExtra(PremiumPlayerActivity.EXTRA_CONTENT_TYPE, contentType);
        intent.putExtra(PremiumPlayerActivity.EXTRA_IS_LIVE, Boolean.TRUE.equals(isLive));
        intent.putExtra(PremiumPlayerActivity.EXTRA_START_POSITION_MS,
            Math.max(0L, Math.round((startPositionSeconds == null ? 0.0 : startPositionSeconds) * 1000.0)));
        intent.putExtra(PremiumPlayerActivity.EXTRA_BUFFER_SECONDS,
            Math.max(2, Math.min(30, bufferSeconds == null ? 8 : bufferSeconds)));

        startActivityForResult(call, intent, "handlePlayerResult");
    }

    @ActivityCallback
    private void handlePlayerResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) {
            return;
        }

        Intent data = activityResult.getData();
        JSObject result = new JSObject();
        if (data == null) {
            result.put("reason", activityResult.getResultCode() == Activity.RESULT_OK ? "closed" : "error");
            result.put("positionSeconds", 0.0);
            result.put("durationSeconds", JSONObject.NULL);
            result.put("retryCount", 0);
            call.resolve(result);
            return;
        }

        long durationMs = data.getLongExtra(PremiumPlayerActivity.RESULT_DURATION_MS, -1L);
        result.put("reason", data.getStringExtra(PremiumPlayerActivity.RESULT_REASON));
        result.put("positionSeconds", data.getLongExtra(PremiumPlayerActivity.RESULT_POSITION_MS, 0L) / 1000.0);
        result.put("durationSeconds", durationMs > 0 ? durationMs / 1000.0 : JSONObject.NULL);
        result.put("retryCount", data.getIntExtra(PremiumPlayerActivity.RESULT_RETRY_COUNT, 0));

        String errorCode = data.getStringExtra(PremiumPlayerActivity.RESULT_ERROR_CODE);
        String errorMessage = data.getStringExtra(PremiumPlayerActivity.RESULT_ERROR_MESSAGE);
        if (errorCode != null) result.put("errorCode", errorCode);
        if (errorMessage != null) result.put("errorMessage", errorMessage);
        call.resolve(result);
    }
}
