package co.luka.finanzas;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import co.luka.finanzas.capture.AutoCapturePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin propio (Kotlin) del registro automático: debe registrarse antes de super.onCreate.
        registerPlugin(AutoCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
