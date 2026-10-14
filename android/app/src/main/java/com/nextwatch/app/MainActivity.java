package com.nextwatch.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Appen är mörk: ljusa ikoner i status- och navigeringsfältet.
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        // Svart WebView-bakgrund: ingen vit blixt innan den fjärrladdade sidan ritats.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(0xFF000000);
        }

        createNotificationChannels();

        // Skyddsnät: webbsidan döljer launch-skärmen själv (SplashScreenHide.tsx,
        // 5 s tak). Kör sidans JS inte alls (gammal WebView, nätverksfel) skulle
        // appen annars fastna på loggan — då släpper vi den härifrån.
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            getBridge().getWebView().evaluateJavascript(
                "try{var p=window.Capacitor&&window.Capacitor.Plugins;p&&p.SplashScreen&&p.SplashScreen.hide()}catch(e){}",
                null
            );
        }, 10000);
    }

    /** Kanal-id:n måste matcha lib/fcm.ts (channelFor). */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel def = new NotificationChannel(
            "nw_default",
            getString(R.string.notif_channel_default),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        nm.createNotificationChannel(def);

        NotificationChannel match = new NotificationChannel(
            "nw_match",
            getString(R.string.notif_channel_match),
            NotificationManager.IMPORTANCE_HIGH
        );
        nm.createNotificationChannel(match);
    }
}
